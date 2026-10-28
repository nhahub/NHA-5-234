variable "region"          { default = "us-east-1" }
variable "project_name"    { type = string }
variable "environment"     { type = string }
variable "instance_type"   { default = "t3.micro" } # free-tier eligible on every account type
variable "public_key_path" { type = string }
variable "allowed_cidr"    { default = "0.0.0.0/0" } # tighten to your IP for SSH/API in real use
