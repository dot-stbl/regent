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
    public string GetString(HttpClient client)
    {
        var task = client.GetStringAsync("https://upstream/info");
        return task.GetAwaiter().GetResult();
    }
}
