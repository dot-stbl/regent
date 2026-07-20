using System;
using System.Threading.Tasks;

namespace Tessera.Modules.Discovery.Controllers;

/// <summary>
/// Fire-and-forget wrapper around an outbound event publisher.
/// </summary>
public sealed class EventAcknowledgement(IPublisher publisher)
{
    public async Task AcknowledgeAsync(string eventId, CancellationToken cancellationToken)
    {
        await publisher.PublishAsync(eventId, cancellationToken);
    }
}
