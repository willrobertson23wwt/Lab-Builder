terraform {
  required_version = ">= 1.6"
  required_providers {
    vcd = {
      source  = "vmware/vcd"
      version = "~> 3.14"
    }
  }
}
