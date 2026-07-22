namespace Test;

using System;
using System.IO;

public sealed class Bridge
{
    public void Handle()
    {
        try
        {
            DoStep();
        }
        catch (IOException e)
        {
            throw;
        }
    }

    private void DoStep() { }
}
