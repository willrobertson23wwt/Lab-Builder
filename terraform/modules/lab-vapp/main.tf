# Data-driven lab vApp. `var.lab` is the parsed labs/<slug>/lab.yaml.
# Shape (see labs/README.md):
#   vapp_name, description, org_network, networks{name => {cidr, gateway, routed?, pool?, dns?}},
#   vms{name => {template, cpus?, memory?, disk_mb?, computer_name?, nics[{net, mode?, ip?}]}},
#   edge_firewall? { default_action, rules[...] }, port_forwards? [{external_port, vm, nic, internal_port, protocol}]

locals {
  lab      = var.lab
  networks = local.lab.networks
  vms      = local.lab.vms
  # Distinct templates referenced by the VMs, looked up once each.
  templates = toset([for k, v in local.vms : v.template])
  # The routed network (exactly one) is the vApp's uplink to the org network.
  routed_nets = [for k, v in local.networks : k if try(v.routed, false)]
}

data "vcd_catalog" "gold" {
  org  = var.org
  name = var.catalog
}

data "vcd_catalog_vapp_template" "tpl" {
  for_each   = local.templates
  org        = var.org
  catalog_id = data.vcd_catalog.gold.id
  name       = each.value
}

resource "vcd_vapp" "lab" {
  org         = var.org
  vdc         = var.vdc
  name        = local.lab.vapp_name
  description = try(local.lab.description, "")
  power_on    = var.power_on

  lifecycle {
    ignore_changes = [lease]
  }
}

resource "vcd_vapp_network" "net" {
  for_each  = local.networks
  org       = var.org
  vdc       = var.vdc
  vapp_name = vcd_vapp.lab.name
  name      = each.key

  gateway       = each.value.gateway
  prefix_length = tonumber(split("/", each.value.cidr)[1])
  dns1          = try(each.value.dns, null)
  # Only the routed network attaches to the org network; the rest are isolated.
  org_network_name = try(each.value.routed, false) ? try(local.lab.org_network, var.default_org_network) : null

  dynamic "static_ip_pool" {
    for_each = try(each.value.pool, null) == null ? [] : [each.value.pool]
    content {
      start_address = static_ip_pool.value[0]
      end_address   = static_ip_pool.value[1]
    }
  }

  reboot_vapp_on_removal = true
}

resource "vcd_vapp_vm" "vm" {
  for_each  = local.vms
  org       = var.org
  vdc       = var.vdc
  vapp_name = vcd_vapp.lab.name
  name      = each.key

  vapp_template_id = data.vcd_catalog_vapp_template.tpl[each.value.template].id
  computer_name    = try(each.value.computer_name, each.key)
  cpus             = try(each.value.cpus, 2)
  cpu_cores        = 1
  memory           = try(each.value.memory, 4096)
  power_on         = var.power_on
  accept_all_eulas = true

  dynamic "override_template_disk" {
    for_each = try(each.value.disk_mb, null) == null ? [] : [each.value.disk_mb]
    content {
      bus_type    = "paravirtual"
      size_in_mb  = override_template_disk.value
      bus_number  = 0
      unit_number = 0
    }
  }

  dynamic "network" {
    for_each = each.value.nics
    content {
      type               = "vapp"
      name               = vcd_vapp_network.net[network.value.net].name
      is_primary         = network.key == 0
      ip_allocation_mode = try(network.value.mode, try(network.value.ip, null) != null ? "MANUAL" : "DHCP")
      ip                 = try(network.value.ip, null)
    }
  }

  customization {
    # Off by default: the ATC images carry their own accounts and the guide's
    # seeded state is applied by Ansible afterwards. Turn on per lab if you
    # want VCD to push hostnames and the MANUAL IPs above into the guests.
    enabled = var.guest_customization
  }

  depends_on = [vcd_vapp_network.net]
}

# Optional vApp-edge firewall on the routed network. Verified against a live
# NSX-T backed vApp by importing its rules: VM-targeted rules use
# destination_vm_id + destination_vm_ip_type = "NAT"; keywords "internal" and
# "external" are valid for source_ip / destination_ip.
resource "vcd_vapp_firewall_rules" "edge" {
  count      = try(local.lab.edge_firewall, null) == null ? 0 : 1
  org        = var.org
  vdc        = var.vdc
  vapp_id    = vcd_vapp.lab.id
  network_id = vcd_vapp_network.net[local.routed_nets[0]].id

  default_action     = try(local.lab.edge_firewall.default_action, "drop")
  log_default_action = try(local.lab.edge_firewall.log_default_action, true)

  dynamic "rule" {
    for_each = try(local.lab.edge_firewall.rules, [])
    content {
      name        = rule.value.name
      enabled     = try(rule.value.enabled, true)
      policy      = try(rule.value.policy, "allow")
      protocol    = try(rule.value.protocol, "any")
      source_port = try(rule.value.source_port, "any")
      # Either an address keyword/range, or a VM (NIC 0) with an ip type.
      source_ip         = try(rule.value.source_vm, null) == null ? try(rule.value.source_ip, "any") : null
      source_vm_id      = try(rule.value.source_vm, null) == null ? null : vcd_vapp_vm.vm[rule.value.source_vm].id
      source_vm_ip_type = try(rule.value.source_vm, null) == null ? null : try(rule.value.source_vm_ip_type, "assigned")
      source_vm_nic_id  = try(rule.value.source_vm, null) == null ? null : try(rule.value.source_vm_nic, 0)

      destination_port       = try(rule.value.destination_port, "any")
      destination_ip         = try(rule.value.destination_vm, null) == null ? try(rule.value.destination_ip, "any") : null
      destination_vm_id      = try(rule.value.destination_vm, null) == null ? null : vcd_vapp_vm.vm[rule.value.destination_vm].id
      destination_vm_ip_type = try(rule.value.destination_vm, null) == null ? null : try(rule.value.destination_vm_ip_type, "NAT")
      destination_vm_nic_id  = try(rule.value.destination_vm, null) == null ? null : try(rule.value.destination_vm_nic, 0)
      enable_logging         = try(rule.value.log, false)
    }
  }
}

# Optional vApp-edge NAT on the routed network.
#   edge_nat: {mode: ip_translation, vm: gateway}          # 1:1 external IP -> that VM (house pattern)
#   edge_nat: {mode: port_forwarding, rules: [{external_port, vm, nic, internal_port, protocol}]}
resource "vcd_vapp_nat_rules" "edge" {
  count      = try(local.lab.edge_nat, null) == null ? 0 : 1
  org        = var.org
  vdc        = var.vdc
  vapp_id    = vcd_vapp.lab.id
  network_id = vcd_vapp_network.net[local.routed_nets[0]].id
  nat_type   = local.lab.edge_nat.mode == "ip_translation" ? "ipTranslation" : "portForwarding"

  dynamic "rule" {
    for_each = local.lab.edge_nat.mode == "ip_translation" ? [local.lab.edge_nat] : []
    content {
      mapping_mode = "automatic"
      vm_id        = vcd_vapp_vm.vm[rule.value.vm].id
      vm_nic_id    = tostring(try(rule.value.nic, 0))
    }
  }

  dynamic "rule" {
    for_each = local.lab.edge_nat.mode == "ip_translation" ? [] : local.lab.edge_nat.rules
    content {
      external_port   = tostring(rule.value.external_port)
      forward_to_port = tostring(rule.value.internal_port)
      protocol        = try(rule.value.protocol, "TCP")
      vm_id           = vcd_vapp_vm.vm[rule.value.vm].id
      vm_nic_id       = tostring(try(rule.value.nic, 0))
    }
  }
  depends_on = [vcd_vapp_firewall_rules.edge]
}
