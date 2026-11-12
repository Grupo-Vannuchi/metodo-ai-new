import "server-only";
import { env } from "@/lib/env";
import { groupAddPilotAllows } from "./core";

/**
 * Whether "Adicionar a grupo do WhatsApp" is on for the organization: listed in WHATSAPP_GROUP_ADD_ORG_IDS. Unset or empty
 * = nobody. Asked on top of the module and screen gates by everything that starts or moves a round: the contacts screen
 * (the button), the tracking screen (notFound), the actions (forbidden) and the runner (a round of an organization taken
 * off the list stops where it is, and goes on if it is listed again). The pure rule is in core.ts (check:group-add).
 */
export function isGroupAddEnabled(organizationId: string): boolean {
  return groupAddPilotAllows(organizationId, env.WHATSAPP_GROUP_ADD_ORG_IDS);
}
