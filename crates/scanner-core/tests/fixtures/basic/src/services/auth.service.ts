import { UserModel } from "../models/user.model";
import { hash } from "../utils/crypto";

export class AuthService {
  public login(email: string): UserModel {
    return { id: hash(email), email };
  }

  public logout(): void {}

  private hashPassword(value: string): string {
    return hash(value);
  }
}
