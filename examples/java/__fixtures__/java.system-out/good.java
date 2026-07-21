// good.java — uses SLF4J logger instead of System.out.
package com.example.orders;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class OrderService {
    private static final Logger LOG = LoggerFactory.getLogger(OrderService.class);

    public void ship(Order order) {
        LOG.info("shipping order id={}", order.id());
        // ... actual shipping logic
    }
}