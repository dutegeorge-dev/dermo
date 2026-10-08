/** Просмотр и редактор страниц базы знаний (TipTap, хранится как JSON). */

import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { TableKit } from "@tiptap/extension-table";
import { EditorContent, type Editor, type JSONContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { type ReactNode, useEffect, useRef } from "react";

import type { Doc } from "../lib/types.ts";

function extensions(placeholder?: string) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: "https",
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      },
    }),
    Image.configure({ inline: false }),
    TableKit.configure({ table: { resizable: false } }),
    ...(placeholder ? [Placeholder.configure({ placeholder })] : []),
  ];
}

/** Только просмотр. */
export function DocView({ doc }: { doc: Doc }) {
  const editor = useEditor({ extensions: extensions(), content: doc as JSONContent, editable: false }, [JSON.stringify(doc)]);
  return <EditorContent editor={editor} className="doc" />;
}

function ToolButton({
  onClick,
  active,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`h-7 min-w-7 rounded px-1.5 text-[13px] leading-none disabled:opacity-30 ${
        active
          ? "bg-accent-soft text-accent dark:bg-accent/25 dark:text-accent-bright"
          : "text-slate-700 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
      }`}
    >
      {children}
    </button>
  );
}

const Sep = () => <span className="mx-1 h-5 w-px bg-slate-200 dark:bg-neutral-700" />;

function Toolbar({ editor, onPickImage }: { editor: Editor; onPickImage: () => void }) {
  const chain = () => editor.chain().focus();
  const inTable = editor.isActive("table");
  const block = editor.isActive("heading", { level: 1 })
    ? "h1"
    : editor.isActive("heading", { level: 2 })
      ? "h2"
      : editor.isActive("heading", { level: 3 })
        ? "h3"
        : "p";

  const setLink = () => {
    const prev = (editor.getAttributes("link").href as string | undefined) ?? "";
    const url = window.prompt("Адрес ссылки (пусто — убрать ссылку)", prev);
    if (url === null) return;
    if (url.trim() === "") chain().extendMarkRange("link").unsetLink().run();
    else chain().extendMarkRange("link").setLink({ href: url.trim() }).run();
  };

  return (
    <div className="sticky top-[49px] z-20 flex flex-wrap items-center gap-0.5 border-b border-slate-200 bg-white/95 px-1 py-1 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/95">
      <select
        aria-label="Тип текста"
        value={block}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "p") chain().setParagraph().run();
          else chain().setHeading({ level: Number(v.slice(1)) as 1 | 2 | 3 }).run();
        }}
        className="h-7 rounded border-0 bg-transparent px-1 text-[13px] text-slate-700 hover:bg-slate-100 focus:ring-0 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        <option value="p">Текст</option>
        <option value="h1">Заголовок 1</option>
        <option value="h2">Заголовок 2</option>
        <option value="h3">Заголовок 3</option>
      </select>
      <Sep />
      <ToolButton title="Жирный (Ctrl+B)" active={editor.isActive("bold")} onClick={() => chain().toggleBold().run()}>
        <b>Ж</b>
      </ToolButton>
      <ToolButton title="Курсив (Ctrl+I)" active={editor.isActive("italic")} onClick={() => chain().toggleItalic().run()}>
        <i>К</i>
      </ToolButton>
      <ToolButton title="Подчёркнутый (Ctrl+U)" active={editor.isActive("underline")} onClick={() => chain().toggleUnderline().run()}>
        <u>Ч</u>
      </ToolButton>
      <ToolButton title="Зачёркнутый" active={editor.isActive("strike")} onClick={() => chain().toggleStrike().run()}>
        <s>З</s>
      </ToolButton>
      <ToolButton title="Код в строке" active={editor.isActive("code")} onClick={() => chain().toggleCode().run()}>
        <code>{"<>"}</code>
      </ToolButton>
      <ToolButton title="Ссылка" active={editor.isActive("link")} onClick={setLink}>
        🔗
      </ToolButton>
      <Sep />
      <ToolButton title="Маркированный список" active={editor.isActive("bulletList")} onClick={() => chain().toggleBulletList().run()}>
        • ≡
      </ToolButton>
      <ToolButton title="Нумерованный список" active={editor.isActive("orderedList")} onClick={() => chain().toggleOrderedList().run()}>
        1.≡
      </ToolButton>
      <ToolButton title="Цитата" active={editor.isActive("blockquote")} onClick={() => chain().toggleBlockquote().run()}>
        ❝
      </ToolButton>
      <ToolButton title="Блок кода" active={editor.isActive("codeBlock")} onClick={() => chain().toggleCodeBlock().run()}>
        {"{ }"}
      </ToolButton>
      <ToolButton title="Разделитель" onClick={() => chain().setHorizontalRule().run()}>
        ―
      </ToolButton>
      <Sep />
      <ToolButton title="Картинка" onClick={onPickImage}>
        🖼
      </ToolButton>
      <ToolButton
        title="Таблица"
        active={inTable}
        onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
        disabled={inTable}
      >
        ▦
      </ToolButton>
      {inTable && (
        <>
          <ToolButton title="Строка ниже" onClick={() => chain().addRowAfter().run()}>
            +стр
          </ToolButton>
          <ToolButton title="Столбец справа" onClick={() => chain().addColumnAfter().run()}>
            +стлб
          </ToolButton>
          <ToolButton title="Удалить строку" onClick={() => chain().deleteRow().run()}>
            −стр
          </ToolButton>
          <ToolButton title="Удалить столбец" onClick={() => chain().deleteColumn().run()}>
            −стлб
          </ToolButton>
          <ToolButton title="Удалить таблицу" onClick={() => chain().deleteTable().run()}>
            ✕▦
          </ToolButton>
        </>
      )}
      <Sep />
      <ToolButton title="Отменить (Ctrl+Z)" disabled={!editor.can().undo()} onClick={() => chain().undo().run()}>
        ↶
      </ToolButton>
      <ToolButton title="Повторить (Ctrl+Shift+Z)" disabled={!editor.can().redo()} onClick={() => chain().redo().run()}>
        ↷
      </ToolButton>
    </div>
  );
}

/** Редактор. uploadImage загружает файл и возвращает его URL. */
export function DocEditor({
  initial,
  onChange,
  uploadImage,
  onError,
}: {
  initial: Doc;
  onChange: (doc: Doc) => void;
  uploadImage: (file: File) => Promise<string>;
  onError: (error: unknown) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const insertImages = async (editor: Editor, files: File[], pos?: number) => {
    for (const file of files) {
      try {
        const src = await uploadImage(file);
        const node = editor.schema.nodes.image.create({ src, alt: file.name });
        if (pos !== undefined) editor.view.dispatch(editor.state.tr.insert(pos, node));
        else editor.chain().focus().setImage({ src, alt: file.name }).run();
      } catch (error) {
        onError(error);
      }
    }
  };

  const editor = useEditor({
    extensions: extensions("Начните писать…"),
    content: initial as JSONContent,
    shouldRerenderOnTransaction: true,
    onUpdate: ({ editor }) => onChangeRef.current(editor.getJSON() as Doc),
    editorProps: {
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
        if (files.length === 0 || !editorRef.current) return false;
        void insertImages(editorRef.current, files);
        return true;
      },
      handleDrop: (view, event) => {
        const files = [...(event.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith("image/"));
        if (files.length === 0 || !editorRef.current) return false;
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        void insertImages(editorRef.current, files, pos);
        return true;
      },
    },
  });
  const editorRef = useRef<Editor | null>(null);
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  if (!editor) return null;
  return (
    <div className="rounded-lg border border-slate-200 dark:border-neutral-800">
      <Toolbar editor={editor} onPickImage={() => fileRef.current?.click()} />
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        multiple
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          void insertImages(editor, files);
        }}
      />
      <EditorContent editor={editor} className="doc px-4 py-4 sm:px-6" />
    </div>
  );
}
