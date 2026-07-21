// bad.java — empty catch block silently swallows the exception.
package com.example.orders;

public class OrderService {
    public void retry(Payment payment) {
        try {
            charge(payment);
        } catch (Exception e) {
        }
    }
}