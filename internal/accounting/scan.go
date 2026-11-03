package accounting

import (
	"bytes"
	"context"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const MaxScanPages = 10
const maxTextBytes = 100_000

type Scanner struct {
	Languages string
	slots     chan struct{}
}

func NewScanner(languages string) *Scanner {
	return &Scanner{Languages: languages, slots: make(chan struct{}, 2)}
}

func (s *Scanner) Ready() error {
	for _, binary := range []string{"pdfinfo", "pdftotext", "pdftoppm", "tesseract"} {
		if _, err := exec.LookPath(binary); err != nil {
			return fmt.Errorf("local scanning requires %s", binary)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	langs, err := command(ctx, "tesseract", "--list-langs")
	if err != nil {
		return err
	}
	for _, language := range strings.Split(s.Languages, "+") {
		if !regexp.MustCompile(`^[a-z_]+$`).MatchString(language) || !strings.Contains("\n"+string(langs), "\n"+language+"\n") {
			return fmt.Errorf("OCR language %q is not installed", language)
		}
	}
	return nil
}

type limitedOutput struct {
	bytes.Buffer
	limit int
}

func (b *limitedOutput) Write(data []byte) (int, error) {
	if b.Len()+len(data) > b.limit {
		return 0, fmt.Errorf("scan output exceeds its limit")
	}
	return b.Buffer.Write(data)
}

func command(ctx context.Context, name string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	var out = limitedOutput{limit: maxTextBytes}
	var stderr = limitedOutput{limit: 4096}
	cmd.Stdout, cmd.Stderr = &out, &stderr
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return nil, fmt.Errorf("local scan timed out or was cancelled: %w", ctx.Err())
		}
		// Do not return parser diagnostics containing private extracted document data.
		return nil, fmt.Errorf("local %s could not process this document: %w", name, err)
	}
	return out.Bytes(), nil
}

func temporary(data []byte, contentType string) (string, string, error) {
	dir, err := os.MkdirTemp("", "odee-scan-")
	if err != nil {
		return "", "", err
	}
	extension := ".pdf"
	if contentType == "image/png" {
		extension = ".png"
	}
	if contentType == "image/jpeg" {
		extension = ".jpg"
	}
	path := filepath.Join(dir, "original"+extension)
	if err := os.WriteFile(path, data, 0600); err != nil {
		cleanup(dir)
		return "", "", err
	}
	return dir, path, nil
}

func cleanup(dir string) {
	if err := os.RemoveAll(dir); err != nil {
		slog.Error("remove private scan temporary directory", "error", err)
	}
}

func pdfPages(ctx context.Context, path string) (int, error) {
	info, err := command(ctx, "pdfinfo", path)
	if err != nil {
		return 0, err
	}
	match := regexp.MustCompile(`(?m)^Pages:\s+(\d+)`).FindSubmatch(info)
	if len(match) != 2 {
		return 0, fmt.Errorf("could not determine PDF page count")
	}
	pages, err := strconv.Atoi(string(match[1]))
	if err != nil || pages < 1 || pages > MaxScanPages {
		return 0, fmt.Errorf("PDF scanning supports 1 to %d pages", MaxScanPages)
	}
	return pages, nil
}

func (s *Scanner) Scan(ctx context.Context, data []byte, contentType string) (Scan, error) {
	if err := s.Ready(); err != nil {
		return emptyScan(), err
	}
	select {
	case s.slots <- struct{}{}:
		defer func() { <-s.slots }()
	case <-ctx.Done():
		return emptyScan(), ctx.Err()
	}
	ctx, cancel := context.WithTimeout(ctx, 120*time.Second)
	defer cancel()
	dir, path, err := temporary(data, contentType)
	if err != nil {
		return emptyScan(), err
	}
	defer cleanup(dir)
	pages := 1
	method := "ocr"
	var text strings.Builder
	if contentType == "application/pdf" {
		pages, err = pdfPages(ctx, path)
		if err != nil {
			return emptyScan(), err
		}
		for page := 1; page <= pages; page++ {
			part, err := command(ctx, "pdftotext", "-layout", "-f", strconv.Itoa(page), "-l", strconv.Itoa(page), path, "-")
			if err != nil {
				return emptyScan(), err
			}
			partText := strings.TrimSpace(string(part))
			if len(partText) < 30 || !moneyPattern.MatchString(partText) {
				if _, err := command(ctx, "pdftoppm", "-f", strconv.Itoa(page), "-l", strconv.Itoa(page), "-scale-to", "1800", "-singlefile", "-png", path, filepath.Join(dir, "page")); err != nil {
					return emptyScan(), err
				}
				part, err = command(ctx, "tesseract", filepath.Join(dir, "page.png"), "stdout", "-l", s.Languages, "--psm", "6")
				if err != nil {
					return emptyScan(), err
				}
				partText = strings.TrimSpace(string(part))
				method = "pdf + ocr"
			} else if method == "ocr" {
				method = "pdf text"
			}
			if text.Len()+len(partText) > maxTextBytes {
				return emptyScan(), fmt.Errorf("extracted text is too long")
			}
			text.WriteString(partText + "\n")
		}
	} else {
		part, err := command(ctx, "tesseract", path, "stdout", "-l", s.Languages, "--psm", "6")
		if err != nil {
			return emptyScan(), err
		}
		text.Write(part)
	}
	if strings.TrimSpace(text.String()) == "" {
		return emptyScan(), fmt.Errorf("no readable text found; complete the bill manually")
	}
	scan := extract(text.String())
	scan.Method, scan.Pages = method, pages
	return scan, nil
}

func (s *Scanner) Preview(ctx context.Context, data []byte, contentType string, page int) ([]byte, string, error) {
	if contentType != "application/pdf" {
		actualType, err := fileType(data)
		if err != nil || actualType != contentType {
			return nil, "", invalid("original is not a supported image")
		}
		return data, contentType, nil
	}
	select {
	case s.slots <- struct{}{}:
		defer func() { <-s.slots }()
	case <-ctx.Done():
		return nil, "", ctx.Err()
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	dir, path, err := temporary(data, contentType)
	if err != nil {
		return nil, "", err
	}
	defer cleanup(dir)
	pages, err := pdfPages(ctx, path)
	if err != nil {
		return nil, "", err
	}
	if page < 1 || page > pages {
		return nil, "", invalid("invalid preview page")
	}
	if _, err := command(ctx, "pdftoppm", "-f", strconv.Itoa(page), "-l", strconv.Itoa(page), "-scale-to", "1800", "-singlefile", "-png", path, filepath.Join(dir, "preview")); err != nil {
		return nil, "", err
	}
	file, err := os.Open(filepath.Join(dir, "preview.png"))
	if err != nil {
		return nil, "", err
	}
	defer func() {
		if err := file.Close(); err != nil {
			slog.Error("close preview image", "error", err)
		}
	}()
	preview, err := io.ReadAll(io.LimitReader(file, MaxFileBytes+1))
	if len(preview) > MaxFileBytes {
		return nil, "", fmt.Errorf("preview exceeds the supported size")
	}
	return preview, "image/png", err
}

func fileType(data []byte) (string, error) {
	if bytes.HasPrefix(data, []byte("%PDF-")) {
		return "application/pdf", nil
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || (format != "jpeg" && format != "png") {
		return "", invalid("upload a PDF, JPEG or PNG bill")
	}
	if config.Width <= 0 || config.Height <= 0 || config.Width > 20000 || config.Height > 20000 || int64(config.Width)*int64(config.Height) > 20_000_000 {
		return "", invalid("bill images may contain at most 20 million pixels")
	}
	if format == "jpeg" {
		return "image/jpeg", nil
	}
	return "image/png", nil
}
