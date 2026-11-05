# Halcyon Micro — Release Notes and Errata (2025)

## HM5V-PD
- **Rev B (errata):** On parts from date codes before 2447, the VBUS over-voltage threshold may measure as low as 21.8 V typical. This is corrected in Rev C, which guarantees 22.0 V typical (21.3 V min, 22.7 V max).
- Workaround for Rev B: set the OVP margin register to +1 step over I2C address 0x28.

## HIMU6
- Rev B adds the 6.4 kHz output data rate. Rev A parts are limited to 1.6 kHz.

## HM3300
- Rev C corrects the datasheet dropout maximum to 300 mV at 500 mA. Silicon is unchanged.

## General
- All parts are RoHS compliant and halogen-free.
- Samples ship within 3 business days; production lead time is 12 weeks.
