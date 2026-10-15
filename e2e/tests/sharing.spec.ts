import { expect, test } from "../harness/fixtures";
import { collectPageErrors } from "../harness/page";

// Needs the members route from choirchaos-pb's pb_hooks.
test.describe("sharing", () => {
  test("the owner adds people by email, changes their role and removes them", async ({ page, admin, factory, loginAs }) => {
    const owner = await factory.createUser({ name: "Owner" });
    const singer = await factory.createUser({ name: "Singer", email: "singer@choirchaos.test" });
    const show = await factory.createShow(owner);
    const errors = collectPageErrors(page);
    await loginAs(owner);
    await page.goto(`/show/${show.id}/edit`);

    await page.getByRole("button", { name: "Share" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Email address").fill("singer@choirchaos.test");
    await dialog.getByRole("button", { name: "Add" }).click();

    await expect(dialog.getByTestId(`member-${singer.id}`)).toContainText("Singer");
    expect(await admin.collection("shows").getOne(show.id)).toMatchObject({ viewers: [singer.id], editors: [] });

    await dialog.getByRole("combobox", { name: "Role of Singer" }).click();
    await page.getByRole("option", { name: "Can edit" }).click();
    await expect.poll(async () => (await admin.collection("shows").getOne(show.id)).editors).toEqual([singer.id]);
    expect((await admin.collection("shows").getOne(show.id)).viewers).toEqual([]);

    await dialog.getByRole("button", { name: "Remove Singer" }).click();
    await expect(dialog.getByTestId(`member-${singer.id}`)).toHaveCount(0);
    expect(await admin.collection("shows").getOne(show.id)).toMatchObject({ viewers: [], editors: [] });
    expect(errors).toEqual([]);
  });

  test("adding an unknown email explains the problem and changes nothing", async ({ page, factory, loginAs, snapshot }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    await loginAs(owner);
    await page.goto(`/show/${show.id}/edit`);
    const before = await snapshot();

    await page.getByRole("button", { name: "Share" }).click();
    await page.getByLabel("Email address").fill("nobody@choirchaos.test");
    await page.getByRole("dialog").getByRole("button", { name: "Add" }).click();

    await expect(page.getByText("There is no account with this email address.")).toBeVisible();
    expect(await snapshot()).toEqual(before);
  });

  test("the owner changes who can open the show", async ({ page, admin, factory, loginAs }) => {
    const owner = await factory.createUser();
    const show = await factory.createShow(owner);
    await loginAs(owner);
    await page.goto(`/show/${show.id}/edit`);

    await page.getByRole("button", { name: "Share" }).click();
    await page.getByRole("combobox", { name: "General access" }).click();
    await page.getByRole("option", { name: "Anyone with the link" }).click();

    await expect.poll(async () => (await admin.collection("shows").getOne(show.id)).visibility).toBe("unlisted");
  });

  test("editors see who has access but cannot change it", async ({ page, factory, loginAs }) => {
    const owner = await factory.createUser({ name: "Owner" });
    const editor = await factory.createUser({ name: "Editor" });
    const show = await factory.createShow(owner, { editors: [editor] });
    await loginAs(editor);
    await page.goto(`/show/${show.id}/edit`);

    await page.getByRole("button", { name: "Share" }).click();
    const dialog = page.getByRole("dialog");

    await expect(dialog.getByTestId(`member-${owner.id}`)).toContainText("Owner");
    await expect(dialog.getByLabel("Email address")).toHaveCount(0);
    await expect(dialog.getByRole("combobox")).toHaveCount(0);
  });
});
