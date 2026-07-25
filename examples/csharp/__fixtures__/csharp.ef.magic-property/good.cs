using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Tessera.Modules.Orders.Persistence;

/// <summary>
/// Entity configuration using the lambda-selector form. A rename of
/// `OrderEntity.Name` propagates to the column automatically — the compiler
/// keeps the link honest, and `.HasColumnName("name")` keeps the on-disk
/// column name stable across renames. This is the only form the AST rule
/// `csharp.ef.magic-property` accepts.
/// </summary>
public sealed class OrderEntityConfiguration : IEntityTypeConfiguration<OrderEntity>
{
    public void Configure(EntityTypeBuilder<OrderEntity> builder)
    {
        builder.ToTable("orders");
        builder.HasKey(c => c.Id);

        builder.Property(c => c.Id).HasColumnName("id");
        builder.Property(c => c.Name).HasColumnName("name").HasMaxLength(256).IsRequired();
        builder.Property(c => c.OrgId).HasColumnName("org_id");
    }
}
