namespace Test;

using System.Threading.Tasks;

public sealed class ClickHandler
{
    public async void HandleClick(object sender, System.EventArgs e)
    {
        await Task.Yield();
    }
}
