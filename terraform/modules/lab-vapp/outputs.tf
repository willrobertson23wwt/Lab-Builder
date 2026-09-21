output "vapp_id" { value = vcd_vapp.lab.id }
output "vapp_name" { value = vcd_vapp.lab.name }
output "vapp_status" { value = vcd_vapp.lab.status_text }

output "vm_ips" {
  description = "Per VM, the vCD-recorded IP of every NIC (MANUAL/POOL only; DHCP shows after the guest leases)."
  value = {
    for k, vm in vcd_vapp_vm.vm : k => [for n in vm.network : "${n.name}=${coalesce(n.ip, "dhcp")}"]
  }
}
