import { Page } from '@playwright/test';
import { Logger } from '../../core/logger/Logger';
import { UserManagementPage } from '../../page_objects/user_management/UserManagementPage';

export class UserManagementAction {
    private readonly userManagementPage: UserManagementPage;

    constructor(page: Page) {
        this.userManagementPage = new UserManagementPage(page);
    }

    async navigateToUserManagement(): Promise<void> {
        Logger.info('Navigating to User Management');
        await this.userManagementPage.gotoUserManagement();
    }

    async createInternalUser(data: {
        firstName: string;
        lastName: string;
        email: string;
        role?: string;
        phone?: string;
    }): Promise<void> {
        Logger.info(`Creating internal user for ${data.email}`);
        await this.userManagementPage.openAddUserFlow();
        await this.userManagementPage.fillUserForm(data.firstName, data.lastName, data.email, data.phone);
        if (data.role) {
            await this.userManagementPage.selectRole(data.role);
        }
        await this.userManagementPage.saveUser();
    }

    async searchUserByEmail(email: string): Promise<void> {
        Logger.info(`Searching for user ${email}`);
        await this.userManagementPage.searchUser(email);
    }

    async openEditForUser(email: string): Promise<void> {
        Logger.info(`Opening edit drawer for ${email}`);
        await this.userManagementPage.openActionMenuForUser(email);
        await this.userManagementPage.clickActionMenuItem('Edit');
        await this.userManagementPage.waitForEditDrawer();
    }

    async deactivateUser(email: string): Promise<void> {
        Logger.info(`Opening deactivate action for ${email}`);
        await this.userManagementPage.openActionMenuForUser(email);
        await this.userManagementPage.clickActionMenuItem('Deactivate');
    }

    async getFeedbackMessage(): Promise<string> {
        return this.userManagementPage.getToastOrAlertText();
    }

    async closeDrawerIfOpen(): Promise<void> {
        await this.userManagementPage.closeDrawerIfOpen();
    }
}
