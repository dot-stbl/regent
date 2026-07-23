namespace Crm.Domain;

/// <summary>Strongly-typed identifier for a quote.</summary>
public readonly record struct QuoteId(Guid Value)
{
    /// <summary>Creates a new <see cref="QuoteId"/>.</summary>
    public static QuoteId New() => new(Guid.NewGuid());

    /// <inheritdoc />
    public override string ToString() => Value.ToString();
}

/// <summary>Strongly-typed identifier for an order.</summary>
public readonly record struct OrderId(Guid Value)
{
    /// <summary>Creates a new <see cref="OrderId"/>.</summary>
    public static OrderId New() => new(Guid.NewGuid());

    /// <inheritdoc />
    public override string ToString() => Value.ToString();
}

/// <summary>Strongly-typed identifier for an invoice.</summary>
public readonly record struct InvoiceId(Guid Value)
{
    /// <summary>Creates a new <see cref="InvoiceId"/>.</summary>
    public static InvoiceId New() => new(Guid.NewGuid());

    /// <inheritdoc />
    public override string ToString() => Value.ToString();
}

/// <summary>
/// Domain event raised when a quote becomes an order.
/// </summary>
public sealed record QuoteOrderedEvent(QuoteId QuoteId, OrderId OrderId, DateTimeOffset OrderedAt);

/// <summary>
/// Domain event raised when an order is invoiced.
/// </summary>
public sealed record OrderInvoicedEvent(OrderId OrderId, InvoiceId InvoiceId, DateTimeOffset InvoicedAt);

/// <summary>
/// A line item on a quote, order, or invoice.
/// </summary>
public sealed record LineItem(string Sku, int Quantity, decimal UnitPrice)
{
    /// <summary>Total price of the line (Quantity × UnitPrice).</summary>
    public decimal LineTotal => UnitPrice * Quantity;
}

/// <summary>
/// Sales quote issued to a customer.
/// </summary>
public sealed class Quote
{
    private readonly List<LineItem> lines = new();

    /// <summary>Primary identifier.</summary>
    public QuoteId Id { get; private set; }

    /// <summary>Account the quote is for.</summary>
    public AccountId AccountId { get; private set; }

    /// <summary>Issue date.</summary>
    public DateOnly IssuedOn { get; private set; }

    /// <summary>Expiration date.</summary>
    public DateOnly ExpiresOn { get; private set; }

    /// <summary>Line items on the quote.</summary>
    public IReadOnlyList<LineItem> Lines => lines;

    private Quote()
    {
    }

    /// <summary>Constructs a new quote.</summary>
    public Quote(QuoteId id, AccountId accountId, DateOnly issuedOn, DateOnly expiresOn, IEnumerable<LineItem> lineItems)
    {
        if (expiresOn < issuedOn)
        {
            throw new ArgumentException("Expiration date cannot precede issue date.", nameof(expiresOn));
        }

        Id = id;
        AccountId = accountId;
        IssuedOn = issuedOn;
        ExpiresOn = expiresOn;
        lines.AddRange(lineItems);
    }

    /// <summary>Total amount of the quote.</summary>
    public decimal Total => lines.Sum(l => l.LineTotal);

    /// <summary>Converts this quote into an order.</summary>
    public Order Order(DateTimeOffset orderedAt)
    {
        if (lines.Count == 0)
        {
            throw new InvalidOperationException("Cannot order a quote with no line items.");
        }

        return Order.Create(orderedAt, this);
    }
}

/// <summary>
/// Sales order confirmed by a customer.
/// </summary>
public sealed class Order
{
    private readonly List<LineItem> lines = new();

    /// <summary>Primary identifier.</summary>
    public OrderId Id { get; private set; }

    /// <summary>Quote this order was generated from.</summary>
    public QuoteId SourceQuoteId { get; private set; }

    /// <summary>Account that placed the order.</summary>
    public AccountId AccountId { get; private set; }

    /// <summary>When the order was placed.</summary>
    public DateTimeOffset OrderedAt { get; private set; }

    /// <summary>Line items copied from the quote.</summary>
    public IReadOnlyList<LineItem> Lines => lines;

    private Order()
    {
    }

    internal Order(OrderId id, QuoteId sourceQuoteId, AccountId accountId, DateTimeOffset orderedAt, IReadOnlyList<LineItem> lineItems)
    {
        Id = id;
        SourceQuoteId = sourceQuoteId;
        AccountId = accountId;
        OrderedAt = orderedAt;
        lines.AddRange(lineItems);
    }

    /// <summary>Factory used by <see cref="Quote.Order"/>.</summary>
    internal static Order Create(DateTimeOffset orderedAt, Quote source)
    {
        ArgumentNullException.ThrowIfNull(source);
        return new Order(OrderId.New(), source.Id, source.AccountId, orderedAt, source.Lines);
    }

    /// <summary>Total amount of the order.</summary>
    public decimal Total => lines.Sum(l => l.LineTotal);

    /// <summary>Generates an invoice for this order.</summary>
    public Invoice Invoice(DateOnly invoiceDate, DateOnly dueDate)
    {
        if (dueDate < invoiceDate)
        {
            throw new ArgumentException("Due date cannot precede invoice date.", nameof(dueDate));
        }

        return Invoice.Create(invoiceDate, dueDate, this);
    }
}

/// <summary>
/// Invoice issued for an order.
/// </summary>
public sealed class Invoice
{
    private readonly List<LineItem> lines = new();

    /// <summary>Primary identifier.</summary>
    public InvoiceId Id { get; private set; }

    /// <summary>Order this invoice was generated from.</summary>
    public OrderId SourceOrderId { get; private set; }

    /// <summary>Account the invoice is billed to.</summary>
    public AccountId AccountId { get; private set; }

    /// <summary>Invoice date.</summary>
    public DateOnly InvoiceDate { get; private set; }

    /// <summary>Payment due date.</summary>
    public DateOnly DueDate { get; private set; }

    /// <summary>Line items on the invoice.</summary>
    public IReadOnlyList<LineItem> Lines => lines;

    private Invoice()
    {
    }

    private Invoice(InvoiceId id, OrderId sourceOrderId, AccountId accountId, DateOnly invoiceDate, DateOnly dueDate, IReadOnlyList<LineItem> lineItems)
    {
        Id = id;
        SourceOrderId = sourceOrderId;
        AccountId = accountId;
        InvoiceDate = invoiceDate;
        DueDate = dueDate;
        lines.AddRange(lineItems);
    }

    internal static Invoice Create(DateOnly invoiceDate, DateOnly dueDate, Order source)
    {
        ArgumentNullException.ThrowIfNull(source);
        return new Invoice(
            InvoiceId.New(),
            source.Id,
            source.AccountId,
            invoiceDate,
            dueDate,
            source.Lines);
    }

    /// <summary>Total amount due on the invoice.</summary>
    public decimal Total => lines.Sum(l => l.LineTotal);
}
