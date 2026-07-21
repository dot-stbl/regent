// bad.java — System.out.println in production code.
package com.example.orders;

public class OrderService {
    public void ship(Order order) {
        System.out.println("shipping " + order.id);
        // ... actual shipping logic
    }
}