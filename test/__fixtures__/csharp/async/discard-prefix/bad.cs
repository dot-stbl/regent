namespace Test;

using System.Threading.Tasks;

public sealed class Cleanup
{
    public async Task RunAsync()
    {
        _ = await Task.Run(() => 42);
    }
}
