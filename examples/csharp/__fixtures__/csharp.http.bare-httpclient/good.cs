using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;

namespace Tessera.Shared.Http;

/// <summary>
/// Authenticated upstream call site. Receives the configured client
/// (Refit-registered with bearer handler + standard resilience handler).
/// </summary>
public sealed class DirectCallSite(IHttpClientFactory factory)
{
    public async Task<string> GetServiceAsync(string baseUrl, CancellationToken cancellationToken)
    {
        var client = factory.CreateClient("upstream");
        return await client.GetStringAsync($"{baseUrl}/health", cancellationToken);
    }
}
