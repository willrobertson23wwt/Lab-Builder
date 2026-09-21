# Per-lab Terraform root. Copied to labs/<slug>/terraform/ by /lab-plan; state
# lives there, one vApp per state. Run through scripts/tf.sh --lab <slug>.
provider "vcd" {
  url               = var.vcd_url
  org               = var.vcd_org
  vdc               = var.vdc
  max_retry_timeout = 120
}

module "lab" {
  source              = "../../../terraform/modules/lab-vapp"
  lab                 = yamldecode(file("${path.module}/../lab.yaml"))
  org                 = var.vcd_org
  vdc                 = var.vdc
  power_on            = var.power_on
  guest_customization = var.guest_customization
  default_org_network = var.org_network
  catalog             = var.catalog
}

output "vapp_name" { value = module.lab.vapp_name }
output "vapp_status" { value = module.lab.vapp_status }
output "vm_ips" { value = module.lab.vm_ips }
