using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;

namespace Tessera.Providers.Victoria.Implementation;

/// <summary>
/// Wraps an upstream <see cref="HttpClient"/> discovery call.
/// </summary>
public sealed class DiscoveryBlocker
{
    public async Task<string> GetAsync(HttpClient client, CancellationToken cancellationToken)
    {
        var task = client.GetStringAsync("https://upstream/entities", cancellationToken);
        return task.Result;
    }
}
