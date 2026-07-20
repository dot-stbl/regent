using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;

namespace Tessera.Providers.Victoria.Implementation;

/// <summary>
/// Synchronous bridge that pretends a Task is a value type. Demonstrates
/// the polite form of the same deadlock as `.Result`.
/// </summary>
public sealed class SyncBridge
{
    public async Task<string> GetStringAsync(HttpClient client, CancellationToken cancellationToken)
    {
        return await client.GetStringAsync("https://upstream/info", cancellationToken);
    }
}
