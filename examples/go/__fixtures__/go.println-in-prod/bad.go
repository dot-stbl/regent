// bad.go — fmt.Println in production code.
package orders

func Ship(orderID string) error {
    fmt.Println("shipping", orderID)
    return charge(orderID)
}