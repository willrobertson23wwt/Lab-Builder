output "vapp_name" {
  value = vcd_vapp.lab.name
}

output "vapp_status" {
  description = "vCD status string as of the last refresh. The provider reads it before a power task settles, so it can lag one apply behind. scripts/vapp-power.sh status queries the API live."
  value       = vcd_vapp.lab.status_text
}

output "vapp_href" {
  value = vcd_vapp.lab.href
}
