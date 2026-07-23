using CloudPlatform.Vms;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace CloudPlatform.Vms;

/// <summary>
/// EF Core fluent configuration for the <see cref="Vm"/> entity.
/// </summary>
public sealed class VmEntityConfiguration : IEntityTypeConfiguration<Vm>
{
    /// <inheritdoc />
    public void Configure(EntityTypeBuilder<Vm> builder)
    {
        builder.ToTable("vms");

        builder.HasKey(v => v.Id);

        builder.Property(v => v.Id)
            .HasColumnName("id")
            .HasConversion(new ValueConverter<VmId, Guid>(v => v.Value, v => new VmId(v)))
            .IsRequired();

        builder.Property(v => v.TenantId)
            .HasColumnName("tenant_id")
            .HasConversion(new ValueConverter<TenantId, Guid>(v => v.Value, v => new TenantId(v)))
            .IsRequired();

        builder.Property(v => v.State)
            .HasColumnName("state")
            .HasConversion<string>()
            .HasMaxLength(32)
            .IsRequired();

        builder.Property(v => v.ProvisioningStartedAt)
            .HasColumnName("provisioning_started_at")
            .HasColumnType("timestamptz");

        builder.Property(v => v.UpdatedAt)
            .HasColumnName("updated_at")
            .HasColumnType("timestamptz")
            .IsRequired();

        builder.HasIndex(v => new { v.TenantId, v.State })
            .HasDatabaseName("ix_vms_tenant_id_state");
    }
}
