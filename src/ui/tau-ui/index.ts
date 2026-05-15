import type { Player, RawMessage } from "@minecraft/server";
import {
  ActionFormData,
  MessageFormData,
  ModalFormData,
  type FormCancelationReason,
} from "@minecraft/server-ui";

export type TauText = string | RawMessage;
export type TauModalValue = boolean | number | string | undefined;

export type TauButton<TValue = undefined> = {
  id: string;
  text: TauText;
  iconPath?: string;
  value?: TValue;
};

export type TauActionElement<TValue = undefined> =
  | { kind: "button"; button: TauButton<TValue> }
  | { kind: "header"; text: TauText }
  | { kind: "label"; text: TauText }
  | { kind: "divider" };

export type TauActionResult<TValue = undefined> =
  | {
      canceled: true;
      reason?: FormCancelationReason;
      error?: unknown;
      selection: undefined;
      id: undefined;
      value: undefined;
      button: undefined;
    }
  | {
      canceled: false;
      reason?: undefined;
      error?: undefined;
      selection: number;
      id: string;
      value: TValue | undefined;
      button: TauButton<TValue>;
    };

export type TauModalField =
  | {
      kind: "toggle";
      key: string;
      label: TauText;
      defaultValue?: boolean;
    }
  | {
      kind: "slider";
      key: string;
      label: TauText;
      min: number;
      max: number;
      step?: number;
      defaultValue?: number;
    }
  | {
      kind: "dropdown";
      key: string;
      label: TauText;
      options: TauText[];
      defaultValueIndex?: number;
    }
  | {
      kind: "text";
      key: string;
      label: TauText;
      placeholder?: TauText;
      defaultValue?: string;
    }
  | { kind: "header"; text: TauText }
  | { kind: "label"; text: TauText }
  | { kind: "divider" };

export type TauModalResult =
  | {
      canceled: true;
      reason?: FormCancelationReason;
      error?: unknown;
      values: undefined;
      rawValues: undefined;
    }
  | {
      canceled: false;
      reason?: undefined;
      error?: undefined;
      values: Record<string, TauModalValue>;
      rawValues: TauModalValue[];
    };

export type TauMessageResult =
  | {
      canceled: true;
      reason?: FormCancelationReason;
      error?: unknown;
      selection: undefined;
    }
  | {
      canceled: false;
      reason?: undefined;
      error?: undefined;
      selection: 0 | 1;
    };

export type TauPage<T> = {
  items: T[];
  page: number;
  pageSize: number;
  pageCount: number;
  startIndex: number;
  hasPrevious: boolean;
  hasNext: boolean;
};

type ModalValueKey = Extract<TauModalField, { key: string }>;

function canceledAction<TValue>(reason?: FormCancelationReason, error?: unknown): TauActionResult<TValue> {
  return {
    canceled: true,
    reason,
    error,
    selection: undefined,
    id: undefined,
    value: undefined,
    button: undefined,
  };
}

function canceledModal(reason?: FormCancelationReason, error?: unknown): TauModalResult {
  return {
    canceled: true,
    reason,
    error,
    values: undefined,
    rawValues: undefined,
  };
}

function canceledMessage(reason?: FormCancelationReason, error?: unknown): TauMessageResult {
  return {
    canceled: true,
    reason,
    error,
    selection: undefined,
  };
}

export class TauActionForm<TValue = undefined> {
  private readonly elements: TauActionElement<TValue>[] = [];
  private bodyText?: TauText;

  constructor(private readonly titleText: TauText) {}

  body(text: TauText): this {
    this.bodyText = text;
    return this;
  }

  header(text: TauText): this {
    this.elements.push({ kind: "header", text });
    return this;
  }

  label(text: TauText): this {
    this.elements.push({ kind: "label", text });
    return this;
  }

  divider(): this {
    this.elements.push({ kind: "divider" });
    return this;
  }

  button(id: string, text: TauText, options: { iconPath?: string; value?: TValue } = {}): this {
    this.elements.push({
      kind: "button",
      button: { id, text, iconPath: options.iconPath, value: options.value },
    });
    return this;
  }

  buttons(buttons: readonly TauButton<TValue>[]): this {
    for (const button of buttons) this.elements.push({ kind: "button", button });
    return this;
  }

  async show(player: Player): Promise<TauActionResult<TValue>> {
    const form = new ActionFormData().title(this.titleText);
    if (this.bodyText !== undefined) form.body(this.bodyText);

    const buttons: TauButton<TValue>[] = [];
    for (const element of this.elements) {
      switch (element.kind) {
        case "button":
          buttons.push(element.button);
          form.button(element.button.text, element.button.iconPath);
          break;
        case "header":
          form.header(element.text);
          break;
        case "label":
          form.label(element.text);
          break;
        case "divider":
          form.divider();
          break;
      }
    }

    if (buttons.length === 0) {
      buttons.push({ id: "close", text: "Close" } as TauButton<TValue>);
      form.button("Close");
    }

    const shown = await form.show(player).then(
      (response) => ({ response }),
      (error: unknown) => ({ error }),
    );
    if ("error" in shown) return canceledAction(undefined, shown.error);

    const { response } = shown;
    if (!response || response.canceled || response.selection === undefined) {
      return canceledAction(response?.cancelationReason);
    }

    const button = buttons[response.selection];
    if (!button) return canceledAction(response.cancelationReason);

    return {
      canceled: false,
      selection: response.selection,
      id: button.id,
      value: button.value,
      button,
    };
  }
}

export class TauModalForm {
  private readonly fields: TauModalField[] = [];
  private submitText: TauText = "Submit";

  constructor(private readonly titleText: TauText) {}

  submitButton(text: TauText): this {
    this.submitText = text;
    return this;
  }

  header(text: TauText): this {
    this.fields.push({ kind: "header", text });
    return this;
  }

  label(text: TauText): this {
    this.fields.push({ kind: "label", text });
    return this;
  }

  divider(): this {
    this.fields.push({ kind: "divider" });
    return this;
  }

  toggle(key: string, label: TauText, defaultValue = false): this {
    this.fields.push({ kind: "toggle", key, label, defaultValue });
    return this;
  }

  slider(key: string, label: TauText, min: number, max: number, options: { step?: number; defaultValue?: number } = {}): this {
    this.fields.push({
      kind: "slider",
      key,
      label,
      min,
      max,
      step: options.step,
      defaultValue: options.defaultValue,
    });
    return this;
  }

  dropdown(key: string, label: TauText, options: readonly TauText[], defaultValueIndex = 0): this {
    this.fields.push({
      kind: "dropdown",
      key,
      label,
      options: Array.from(options),
      defaultValueIndex,
    });
    return this;
  }

  text(key: string, label: TauText, options: { placeholder?: TauText; defaultValue?: string } = {}): this {
    this.fields.push({
      kind: "text",
      key,
      label,
      placeholder: options.placeholder,
      defaultValue: options.defaultValue,
    });
    return this;
  }

  async show(player: Player): Promise<TauModalResult> {
    const form = new ModalFormData().title(this.titleText).submitButton(this.submitText);
    const keyedFields: ModalValueKey[] = [];

    for (const field of this.fields) {
      switch (field.kind) {
        case "toggle":
          keyedFields.push(field);
          form.toggle(field.label, { defaultValue: field.defaultValue });
          break;
        case "slider":
          keyedFields.push(field);
          form.slider(field.label, field.min, field.max, {
            defaultValue: field.defaultValue,
            valueStep: field.step,
          });
          break;
        case "dropdown":
          keyedFields.push(field);
          form.dropdown(field.label, field.options, { defaultValueIndex: field.defaultValueIndex });
          break;
        case "text":
          keyedFields.push(field);
          form.textField(field.label, field.placeholder ?? "", { defaultValue: field.defaultValue });
          break;
        case "header":
          form.header(field.text);
          break;
        case "label":
          form.label(field.text);
          break;
        case "divider":
          form.divider();
          break;
      }
    }

    const shown = await form.show(player).then(
      (response) => ({ response }),
      (error: unknown) => ({ error }),
    );
    if ("error" in shown) return canceledModal(undefined, shown.error);

    const { response } = shown;
    if (!response || response.canceled || !response.formValues) {
      return canceledModal(response?.cancelationReason);
    }

    const values: Record<string, TauModalValue> = {};
    for (let index = 0; index < keyedFields.length; index++) {
      values[keyedFields[index].key] = response.formValues[index];
    }

    return {
      canceled: false,
      values,
      rawValues: response.formValues,
    };
  }
}

export class TauMessageForm {
  private bodyText: TauText = "";
  private firstButtonText: TauText = "Yes";
  private secondButtonText: TauText = "No";

  constructor(private readonly titleText: TauText) {}

  body(text: TauText): this {
    this.bodyText = text;
    return this;
  }

  button1(text: TauText): this {
    this.firstButtonText = text;
    return this;
  }

  button2(text: TauText): this {
    this.secondButtonText = text;
    return this;
  }

  async show(player: Player): Promise<TauMessageResult> {
    const shown = await new MessageFormData()
      .title(this.titleText)
      .body(this.bodyText)
      .button1(this.firstButtonText)
      .button2(this.secondButtonText)
      .show(player)
      .then(
        (response) => ({ response }),
        (error: unknown) => ({ error }),
      );

    if ("error" in shown) return canceledMessage(undefined, shown.error);

    const { response } = shown;
    if (!response || response.canceled || response.selection === undefined) {
      return canceledMessage(response?.cancelationReason);
    }

    return { canceled: false, selection: response.selection === 0 ? 0 : 1 };
  }
}

export function paginate<T>(items: readonly T[], page: number, pageSize: number): TauPage<T> {
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const pageCount = Math.max(1, Math.ceil(items.length / safePageSize));
  const safePage = Math.min(Math.max(0, Math.floor(page)), pageCount - 1);
  const startIndex = safePage * safePageSize;

  return {
    items: items.slice(startIndex, startIndex + safePageSize),
    page: safePage,
    pageSize: safePageSize,
    pageCount,
    startIndex,
    hasPrevious: safePage > 0,
    hasNext: safePage < pageCount - 1,
  };
}

export function action<TValue = undefined>(title: TauText): TauActionForm<TValue> {
  return new TauActionForm<TValue>(title);
}

export function modal(title: TauText): TauModalForm {
  return new TauModalForm(title);
}

export function message(title: TauText): TauMessageForm {
  return new TauMessageForm(title);
}

export async function confirm(
  player: Player,
  options: { title: TauText; body: TauText; confirmText?: TauText; cancelText?: TauText },
): Promise<boolean> {
  const result = await message(options.title)
    .body(options.body)
    .button1(options.confirmText ?? "Confirm")
    .button2(options.cancelText ?? "Cancel")
    .show(player);

  return !result.canceled && result.selection === 0;
}

export const TauUi = {
  action,
  modal,
  message,
  confirm,
  paginate,
};
