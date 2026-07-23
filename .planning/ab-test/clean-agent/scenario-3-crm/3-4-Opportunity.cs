namespace Crm.Domain;

/// <summary>Strongly-typed identifier for an opportunity.</summary>
public readonly record struct OpportunityId(Guid Value)
{
    /// <summary>Creates a new <see cref="OpportunityId"/>.</summary>
    public static OpportunityId New() => new(Guid.NewGuid());

    /// <inheritdoc />
    public override string ToString() => Value.ToString();
}

/// <summary>Stage of an opportunity in the sales pipeline.</summary>
public enum OpportunityStage
{
    Prospect = 0,
    Qualification = 1,
    Proposal = 2,
    Negotiation = 3,
    ClosedWon = 4,
    ClosedLost = 5,
}

/// <summary>
/// Aggregate root for a sales opportunity.
/// </summary>
public sealed class Opportunity
{
    /// <summary>Primary identifier.</summary>
    public OpportunityId Id { get; private set; }

    /// <summary>Account this opportunity is associated with.</summary>
    public AccountId AccountId { get; private set; }

    /// <summary>Short title of the opportunity.</summary>
    public string Title { get; private set; } = string.Empty;

    /// <summary>Estimated monetary amount.</summary>
    public decimal Amount { get; private set; }

    /// <summary>Expected close date.</summary>
    public DateOnly CloseDate { get; private set; }

    /// <summary>Current stage.</summary>
    public OpportunityStage Stage { get; private set; }

    private Opportunity()
    {
    }

    /// <summary>Constructs a new opportunity in the <see cref="OpportunityStage.Prospect"/> state.</summary>
    public Opportunity(
        OpportunityId id,
        AccountId accountId,
        string title,
        decimal amount,
        DateOnly closeDate)
    {
        if (string.IsNullOrWhiteSpace(title))
        {
            throw new ArgumentException("Title must be provided.", nameof(title));
        }

        if (amount < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(amount), "Amount cannot be negative.");
        }

        Id = id;
        AccountId = accountId;
        Title = title.Trim();
        Amount = amount;
        CloseDate = closeDate;
        Stage = OpportunityStage.Prospect;
    }

    /// <summary>Validates the transition and advances to the supplied stage.</summary>
    /// <exception cref="InvalidOperationException">When the transition is not allowed.</exception>
    public void AdvanceTo(OpportunityStage next)
    {
        if (Stage is OpportunityStage.ClosedWon or OpportunityStage.ClosedLost)
        {
            throw new InvalidOperationException(
                $"Opportunity {Id} is already closed in stage {Stage} and cannot be advanced.");
        }

        if (!IsAllowedTransition(Stage, next))
        {
            throw new InvalidOperationException(
                $"Cannot move opportunity {Id} from {Stage} to {next}.");
        }

        Stage = next;
    }

    private static bool IsAllowedTransition(OpportunityStage from, OpportunityStage to)
    {
        return (from, to) switch
        {
            (OpportunityStage.Prospect, OpportunityStage.Qualification) => true,
            (OpportunityStage.Qualification, OpportunityStage.Proposal) => true,
            (OpportunityStage.Proposal, OpportunityStage.Negotiation) => true,
            (OpportunityStage.Negotiation, OpportunityStage.ClosedWon) => true,
            (OpportunityStage.Negotiation, OpportunityStage.ClosedLost) => true,
            (OpportunityStage.Proposal, OpportunityStage.ClosedLost) => true,
            (OpportunityStage.Qualification, OpportunityStage.ClosedLost) => true,
            (OpportunityStage.Prospect, OpportunityStage.ClosedLost) => true,
            _ => false,
        };
    }
}
