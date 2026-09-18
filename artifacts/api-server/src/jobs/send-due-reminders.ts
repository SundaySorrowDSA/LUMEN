import { deliverDueReminderNotifications } from "../tools/push-notifications.js";

deliverDueReminderNotifications()
  .then((result) => {
    console.log(JSON.stringify(result));
    process.exit(0);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Push delivery failed");
    process.exit(1);
  });