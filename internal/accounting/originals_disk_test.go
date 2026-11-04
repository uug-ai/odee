package accounting

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

func TestDiskOriginalsPersistenceAndIntegrity(t *testing.T) {
	ctx, directory := context.Background(), t.TempDir()
	disk, err := newDiskOriginals(ctx, directory)
	if err != nil {
		t.Fatal(err)
	}
	data := samplePDF(sampleText)
	item := importMetadata(testCompany, data)
	var writers sync.WaitGroup
	for range 4 {
		writers.Go(func() {
			if err := disk.write(ctx, item, data); err != nil {
				t.Error(err)
			}
		})
	}
	writers.Wait()
	name, err := originalDiskPath(item.OrganisationID, item.ProjectID, item.SHA256)
	if err != nil {
		t.Fatal(err)
	}
	files, err := os.ReadDir(filepath.Join(directory, filepath.Dir(name)))
	if err != nil || len(files) != 1 || files[0].Name() != item.SHA256 {
		t.Fatal("duplicate writes must leave one complete original and no temporary files", err)
	}
	reopened, err := newDiskOriginals(ctx, directory)
	if err != nil {
		t.Fatal(err)
	}
	if saved, err := reopened.read(ctx, item, item.SHA256); err != nil || !bytes.Equal(saved, data) {
		t.Fatal("original did not survive reopening", err)
	}
	other := importMetadata(primitive.NewObjectID(), data)
	if _, err := reopened.read(ctx, other, other.SHA256); err == nil {
		t.Fatal("filesystem paths must be tenant-scoped")
	}
	if err := reopened.write(ctx, other, data); err != nil {
		t.Fatal("same bytes must be independently available to another tenant", err)
	}
	if err := reopened.write(ctx, item, []byte("different")); err == nil {
		t.Fatal("mismatched bytes must not replace an original")
	}
	damaged := bytes.Clone(data)
	damaged[0] = '!'
	if err := os.WriteFile(filepath.Join(directory, name), damaged, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := reopened.read(ctx, item, item.SHA256); err == nil {
		t.Fatal("corrupt original must fail integrity verification")
	}
	if err := reopened.write(ctx, item, data); err == nil {
		t.Fatal("a damaged existing original must not be silently overwritten")
	}
}

func TestDiskOriginalsRejectUnsafePathsAndUnavailableVolumes(t *testing.T) {
	ctx, directory := context.Background(), t.TempDir()
	for _, invalidDirectory := range []string{"relative/documents", filepath.Join(directory, "not-mounted")} {
		if _, err := newDiskOriginals(ctx, invalidDirectory); err == nil {
			t.Fatal("an explicit missing/relative document directory must fail startup")
		}
	}
	disk, err := newDiskOriginals(ctx, directory)
	if err != nil {
		t.Fatal(err)
	}
	data := samplePDF(sampleText)
	item := importMetadata(testCompany, data)
	for _, key := range []string{"../outside", strings.Repeat("a", 63), strings.Repeat("A", 64)} {
		invalid := item
		invalid.SHA256 = key
		if err := disk.write(ctx, invalid, data); err == nil {
			t.Fatal("invalid content key was accepted")
		}
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if err := disk.write(cancelled, item, data); err == nil {
		t.Fatal("cancelled writes must fail")
	}
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(directory, testCompany.Hex())); err != nil {
		t.Fatal(err)
	}
	if err := disk.write(ctx, item, data); err == nil {
		t.Fatal("a symlink must not escape the document volume")
	}
	if files, err := os.ReadDir(outside); err != nil || len(files) != 0 {
		t.Fatal("write escaped the configured volume", err)
	}
}
