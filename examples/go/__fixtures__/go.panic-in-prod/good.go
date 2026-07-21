// good.go — returns an error instead of panicking.
package orders

import "errors"

func Lookup(id string) (*Order, error) {
    row := db.Query(id)
    if row == nil {
        return nil, errors.New("order not found")
    }
    return row, nil
}