package accounting

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

type diskOriginals struct {
	directory string
}

func newDiskOriginals(ctx context.Context, directory string) (_ *diskOriginals, err error) {
	if !filepath.IsAbs(directory) {
		return nil, fmt.Errorf("ODEE_DOCUMENTS_DIR must be an absolute path to an existing writable directory")
	}
	root, err := os.OpenRoot(directory)
	if err != nil {
		return nil, fmt.Errorf("open document volume: %w", err)
	}
	defer func() { err = errors.Join(err, root.Close()) }()
	probe := ".odee-write-check-" + primitive.NewObjectID().Hex()
	if err := writeSyncedOriginal(ctx, root, probe, []byte("odee")); err != nil {
		return nil, fmt.Errorf("document volume is not writable: %w", err)
	}
	if err := removeOriginalTemporary(root, probe); err != nil {
		return nil, err
	}
	return &diskOriginals{directory: filepath.Clean(directory)}, nil
}

func originalDiskPath(organisation, project primitive.ObjectID, key string) (string, error) {
	hash, err := hex.DecodeString(key)
	if organisation.IsZero() || project.IsZero() || err != nil || len(hash) != sha256.Size || hex.EncodeToString(hash) != key {
		return "", fmt.Errorf("invalid document volume ownership or content key")
	}
	return filepath.Join(organisation.Hex(), project.Hex(), key), nil
}

func writeSyncedOriginal(ctx context.Context, root *os.Root, name string, data []byte) (err error) {
	if err := ctx.Err(); err != nil {
		return err
	}
	file, err := root.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	defer func() {
		err = errors.Join(err, file.Close())
		if err != nil {
			err = errors.Join(err, removeOriginalTemporary(root, name))
		}
	}()
	if _, err := io.Copy(file, bytes.NewReader(data)); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return file.Sync()
}

func syncOriginalDirectory(root *os.Root, name string) (err error) {
	directory, err := root.Open(name)
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, directory.Close()) }()
	return directory.Sync()
}

func removeOriginalTemporary(root *os.Root, name string) error {
	if err := root.Remove(name); err != nil {
		return fmt.Errorf("remove temporary original: %w", err)
	}
	return syncOriginalDirectory(root, filepath.Dir(name))
}

func (d *diskOriginals) write(ctx context.Context, item BillImport, data []byte) (err error) {
	if err := ctx.Err(); err != nil {
		return err
	}
	name, err := originalDiskPath(item.OrganisationID, item.ProjectID, item.SHA256)
	if err != nil {
		return err
	}
	hash := sha256.Sum256(data)
	if len(data) > MaxFileBytes || int64(len(data)) != item.Size || hex.EncodeToString(hash[:]) != item.SHA256 {
		return fmt.Errorf("original bytes do not match document size and checksum")
	}
	root, err := os.OpenRoot(d.directory)
	if err != nil {
		return fmt.Errorf("open document volume: %w", err)
	}
	defer func() { err = errors.Join(err, root.Close()) }()
	parent := filepath.Dir(name)
	if err := root.MkdirAll(parent, 0750); err != nil {
		return fmt.Errorf("create scoped document directory: %w", err)
	}
	temporary := filepath.Join(parent, ".upload-"+primitive.NewObjectID().Hex())
	if err := writeSyncedOriginal(ctx, root, temporary, data); err != nil {
		return fmt.Errorf("write document original: %w", err)
	}
	defer func() { err = errors.Join(err, removeOriginalTemporary(root, temporary)) }()
	if err := ctx.Err(); err != nil {
		return err
	}
	// Link publishes a complete, synced file without replacing an existing original.
	if err := root.Link(temporary, name); err != nil {
		if !errors.Is(err, os.ErrExist) {
			return fmt.Errorf("publish document original: %w", err)
		}
		if _, err := d.read(ctx, item, item.SHA256); err != nil {
			return fmt.Errorf("verify existing original before reuse: %w", err)
		}
	}
	for _, directory := range []string{parent, filepath.Dir(parent), "."} {
		if err := syncOriginalDirectory(root, directory); err != nil {
			return fmt.Errorf("sync document directory: %w", err)
		}
	}
	return nil
}

func (d *diskOriginals) read(ctx context.Context, item BillImport, key string) (_ []byte, err error) {
	name, err := originalDiskPath(item.OrganisationID, item.ProjectID, key)
	if err != nil {
		return nil, err
	}
	if key != item.SHA256 || item.Size < 0 || item.Size > MaxFileBytes {
		return nil, fmt.Errorf("stored original metadata is inconsistent")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(d.directory)
	if err != nil {
		return nil, fmt.Errorf("open document volume: %w", err)
	}
	defer func() { err = errors.Join(err, root.Close()) }()
	file, err := root.Open(name)
	if err != nil {
		return nil, fmt.Errorf("open document original: %w", err)
	}
	defer func() { err = errors.Join(err, file.Close()) }()
	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() != item.Size {
		return nil, fmt.Errorf("stored original size or file type is inconsistent")
	}
	data, err := io.ReadAll(io.LimitReader(file, MaxFileBytes+1))
	if err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	hash := sha256.Sum256(data)
	if int64(len(data)) != item.Size || hex.EncodeToString(hash[:]) != key {
		return nil, fmt.Errorf("stored original checksum is inconsistent")
	}
	return data, nil
}
