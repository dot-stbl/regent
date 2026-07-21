// bad.go — panic() in a library function.
package orders

func Lookup(id string) *Order {
    row := db.Query(id)
    if row == nil {
        panic("order not found")
    }
    return row
}