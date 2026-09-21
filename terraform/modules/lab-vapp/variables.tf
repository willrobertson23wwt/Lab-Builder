variable "lab" {
  description = "Parsed lab.yaml (see labs/README.md for the schema)."
  type        = any
}

variable "org" { type = string }
variable "vdc" { type = string }

variable "catalog" {
  description = "Catalog holding the golden images."
  type        = string
}

variable "default_org_network" {
  description = "Routed Org VDC network the vApp uplinks to when lab.yaml does not name one."
  type        = string
}

variable "power_on" {
  type    = bool
  default = false
}

variable "guest_customization" {
  type    = bool
  default = false
}
