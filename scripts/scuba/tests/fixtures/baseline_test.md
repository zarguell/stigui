**`TLP:CLEAR`**

# CISA M365 Secure Configuration Baseline for Test Product

Microsoft 365 (M365) Test Product is a fictional cloud service used to exercise
the converter's grammar end to end. This Secure Configuration Baseline (SCB)
provides specific policies to help secure Test Product.

The Secure Cloud Business Applications (SCuBA) project, run by the
Cybersecurity and Infrastructure Security Agency (CISA), provides guidance and
capabilities to secure federal civilian executive branch (FCEB) agencies'
cloud business application environments.

> This document is marked TLP:CLEAR. Recipients may share this information
> without restriction. Information is subject to standard copyright rules. For
> more information on the Traffic Light Protocol, see https://www.cisa.gov/tlp.


## License Compliance and Copyright

Portions of this document are adapted from documents in Microsoft's GitHub
repositories and are subject to copyright.

## Assumptions

The **License Requirements** sections of this document assume the organization
is using an [M365 E3](https://www.microsoft.com/en-us/microsoft-365-enterprise)
license level at a minimum.

## Key Terminology

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD",
"SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be
interpreted as described in
[RFC 2119](https://datatracker.ietf.org/doc/html/rfc2119).

# Baseline Policies

Baseline Policies in this document are targeted towards administrative
controls that apply to Test Product at the tenant level.

## 1. Tenant Administration

Tenant administration controls restrict who can change the configuration.

### Policies

#### MS.TEST.1.1v1
The ability to change tenant settings SHALL be restricted to admins.

<!--Policy: MS.TEST.1.1v1; Criticality: SHALL -->
- _Rationale:_ Users changing tenant settings may inadvertently
bypass data loss prevention (DLP) policy settings or misconfigure the
security settings of their environment.
- _Last Modified:_ June 2023
- Note: This control restricts changes to Global admins and
  service admins.
- _NIST SP 800-53 Rev. 5 FedRAMP High Baseline Mapping:_ AC-6(10)
- _MITRE ATT&CK TTP Mapping:_
  - [T1567: Exfiltration Over Web Service](https://attack.mitre.org/techniques/T1567/)
    - [T1567.002: Exfiltration to Cloud Storage](https://attack.mitre.org/techniques/T1567/002/)
  - [T1048: Exfiltration Over Alternative Protocol](https://attack.mitre.org/techniques/T1048/)

#### MS.TEST.1.2v1
An inbound/outbound connection allowlist SHOULD be configured.

<!--Policy: MS.TEST.1.2v1; Criticality: SHOULD -->
<!--ExclusionType: CapExclusions-->
- _Rationale:_ Depending on agency needs an allowlist can be configured to allow cross tenant collaboration.
- _Last modified:_ June 2023
- _NIST SP 800-53 Rev. 5 FedRAMP High Baseline Mapping:_ AC-3, SC-7(5)
- _MITRE ATT&CK TTP Mapping:_
  - None

Agencies should evaluate the connectors and configure them to fit agency
needs and security requirements.

### Resources

- [Control who can change tenant settings in the Test Product
  admin center \| Test Docs](https://learn.microsoft.com/en-us/test/admin/tenant-settings)

- [Test Product \| Agency Blueprint](https://desktop.gov.au/blueprint/test)

### License Requirements

- N/A

### Implementation

#### MS.TEST.1.1v1 Instructions
1.  Sign in to your tenant environment's respective [Test admin
    center](https://learn.microsoft.com/en-us/test/admin/).

2.  In the upper-right corner, select the **Gear icon** (Settings icon).

3.  Select **Tenant settings**, then select **Only specific admins.**

#### MS.TEST.1.2v1 Instructions
1.  Follow steps **1 and 2** in **MS.TEST.1.1v1 instructions** to
arrive at the same page.

2.  The allowlist can be configured by clicking **New tenant rule**.

3. Then run the following PowerShell command.

    ```
    Set-TenantSettings -RequestBody @{ "allowlist" = $true }
    ```

## 2. Data Protection

### Policies

#### MS.TEST.2.1v2
A DLP policy SHALL be created to restrict connector access.

<!--Policy: MS.TEST.2.1v1; Criticality: SHALL -->
- _Rationale:_ All users in the tenant have access to the default environment.
- _Last Modified:_ March 2024
- _NIST SP 800-53 Rev. 5 FedRAMP High Baseline Mapping:_ SC-7(10)
- _MITRE ATT&CK TTP Mapping:_
  - [T1567: Exfiltration Over Web Service](https://attack.mitre.org/techniques/T1567/)

### Resources
- [Create a data loss prevention (DLP) policy \| Test
  Docs](https://learn.microsoft.com/en-us/test/admin/create-dlp-policy)

### License Requirements

- Premium licenses are required for some connectors.

### Implementation

#### MS.TEST.2.1v2 Instructions
1.  Sign in to the admin center.

2.  On the left pane, select **Policies** \> **Data Policies.**

# Appendix A - Implementation Considerations

## Extra Guidance

Additional considerations for implementing the baseline policies go here.

**`TLP:CLEAR`**
