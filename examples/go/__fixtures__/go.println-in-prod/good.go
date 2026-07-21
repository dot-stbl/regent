// good.go — uses log/slog instead of fmt.Println.
package orders

import "log/slog"

func Ship(orderID string) error {
    slog.Info("shipping order", "order_id", orderID)
    return charge(orderID)
}