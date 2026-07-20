using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;

namespace Tessera.Providers.Victoria.Implementation;

/// <summary>
/// App-level HTTP wrapper. NOT library code; this is the boundary
/// that bridges .NET's SynchronizationContext-free runtime and
/// the outward network.
/// </summary>
public sealed class AppLevelHttp
{
    public async Task<string> GetAsync(HttpClient client, CancellationToken cancellationToken)
    {
        return await client
            .GetStringAsync("https://upstream/entities", cancellationToken)
            .ConfigureAwait(false);
    }
}
