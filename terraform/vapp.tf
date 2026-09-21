# This vApp already exists in vCD. Bring it under management with:
#   scripts/tf.sh import vcd_vapp.lab "$VCD_ORG.$TF_VAR_vdc.$TF_VAR_vapp_name"
# After that, changing var.power_on and applying powers it on or off.
resource "vcd_vapp" "lab" {
  org      = var.vcd_org
  vdc      = var.vdc
  name     = var.vapp_name
  power_on = var.power_on

  lifecycle {
    # Milestone 1 is power control only. Refuse to delete the vApp.
    prevent_destroy = true
    # Attributes we did not author and do not want to fight over after import.
    ignore_changes = [description, lease, metadata_entry, guest_properties]
  }
}
