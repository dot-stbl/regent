namespace Test;

using System;

public sealed class Bridge
{
    public void Handle()
    {
        try
        {
            DoStep();
        }
        catch (Exception e)
        {
            throw;
        }
    }

    private void DoStep() { }
}
