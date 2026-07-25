using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Tessera.Modules.Orders.Persistence;

/// <summary>
/// Entity configuration that uses the magic-string `builder.Property("...")`
/// form. A future rename of the `Name` property on the entity will leave the
/// fluent mapping pointing at a non-existent property — EF Core will compile
/// but the runtime will read the wrong column. Use a lambda selector instead
/// so the compiler enforces the link.
/// </summary>
public sealed class OrderEntityConfiguration : IEntityTypeConfiguration<OrderEntity>
{
    public void Configure(EntityTypeBuilder<OrderEntity> builder)
    {
        builder.ToTable("orders");
        builder.HasKey(c => c.Id);

        builder.Property("Id").HasColumnName("id");
        builder.Property("Name").HasColumnName("name").HasMaxLength(256).IsRequired();
        builder.Property("OrgId").HasColumnName("org_id");
    }
}
