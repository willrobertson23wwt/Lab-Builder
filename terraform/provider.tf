# Endpoint, org and VDC come from TF_VAR_* in .env; the credential comes from
# VCD_AUTH_TYPE + VCD_USER/VCD_PASSWORD (or VCD_API_TOKEN), which the provider
# reads from the environment. TLS verification follows VCD_ALLOW_UNVERIFIED_SSL.
# scripts/tf.sh loads .env, so no secret is ever written to this repo.
provider "vcd" {
  url               = var.vcd_url
  org               = var.vcd_org
  vdc               = var.vdc
  max_retry_timeout = 120
}
