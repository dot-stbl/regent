// good.java — catch block logs and rethrows (or converts to domain error).
package com.example.orders;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class OrderService {
    private static final Logger LOG = LoggerFactory.getLogger(OrderService.class);

    public void retry(Payment payment) throws PaymentFailedException {
        try { charge(payment); }
        catch (PaymentFailedException e) {
            LOG.warn("retry failed for payment {}", payment.id(), e);
            throw e;
        }
    }
}