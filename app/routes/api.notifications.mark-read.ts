import { data } from "react-router";
import * as v from "valibot";
import type { Route } from "./+types/api.notifications.mark-read";
import { getCurrentUserId } from "~/lib/session";
import { getNotificationById, markAsRead } from "~/services/notificationService";
import { parseJsonBody } from "~/lib/validation";

const markReadSchema = v.object({
  notificationId: v.number(),
});

export async function action({ request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("Unauthorized", { status: 401 });
  }

  const parsed = await parseJsonBody(request, markReadSchema);
  if (!parsed.success) {
    throw data("Invalid parameters", { status: 400 });
  }

  const notification = getNotificationById(parsed.data.notificationId);
  if (!notification || notification.recipientUserId !== currentUserId) {
    throw data("Not found", { status: 404 });
  }

  markAsRead(notification.id);

  return { success: true };
}
