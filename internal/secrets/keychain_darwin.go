package secrets

import (
	"errors"

	keychain "github.com/keybase/go-keychain"
)

const service = "com.datagrid.app"

// ErrNotFound is returned when no secret exists for a ref.
var ErrNotFound = errors.New("secret not found")

// keychainStore stores secrets as generic passwords in the macOS Keychain,
// one item per ref, all under the app's service name.
type keychainStore struct{}

// NewStore returns the platform secret store.
func NewStore() Store {
	return &keychainStore{}
}

func (k *keychainStore) Set(ref string, secret []byte) error {
	item := keychain.NewGenericPassword(service, ref, "DataGrid", secret, "")
	item.SetAccessible(keychain.AccessibleWhenUnlocked)
	err := keychain.AddItem(item)
	if errors.Is(err, keychain.ErrorDuplicateItem) {
		query := keychain.NewGenericPassword(service, ref, "", nil, "")
		update := keychain.NewItem()
		update.SetData(secret)
		return keychain.UpdateItem(query, update)
	}
	return err
}

func (k *keychainStore) Get(ref string) ([]byte, error) {
	data, err := keychain.GetGenericPassword(service, ref, "", "")
	if err != nil {
		return nil, err
	}
	if data == nil {
		return nil, ErrNotFound
	}
	return data, nil
}

func (k *keychainStore) Delete(ref string) error {
	err := keychain.DeleteGenericPasswordItem(service, ref)
	if errors.Is(err, keychain.ErrorItemNotFound) {
		return nil
	}
	return err
}
