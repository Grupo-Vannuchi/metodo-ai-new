"use client";

import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Link2,
  RemoveFormatting,
  Braces,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type EditorVariable = { token: string; label: string };

const SWATCHES = ["#18375d", "#0f172a", "#dc2626", "#16a34a", "#d97706", "#64748b"];

function Btn({
  onClick,
  active,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={cn(
        "flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        active ? "bg-brand/10 text-brand" : "",
      )}
    >
      {children}
    </button>
  );
}

const Divider = () => <span className="mx-0.5 h-5 w-px bg-border" />;

function Toolbar({ editor, variables }: { editor: Editor; variables?: EditorVariable[] }) {
  const [varOpen, setVarOpen] = useState(false);

  const setLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("URL", prev ?? "https://");
    if (url === null) return;
    if (url.trim() === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  };

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-border bg-muted/30 p-1">
      <Btn title="Negrito" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold className="size-4" />
      </Btn>
      <Btn title="Itálico" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic className="size-4" />
      </Btn>
      <Btn title="Sublinhado" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <UnderlineIcon className="size-4" />
      </Btn>
      <Btn title="Tachado" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <Strikethrough className="size-4" />
      </Btn>
      <Divider />
      <Btn title="Título" active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
        <Heading2 className="size-4" />
      </Btn>
      <Btn title="Subtítulo" active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
        <Heading3 className="size-4" />
      </Btn>
      <Divider />
      <Btn title="Lista" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List className="size-4" />
      </Btn>
      <Btn title="Lista numerada" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered className="size-4" />
      </Btn>
      <Divider />
      <Btn title="Alinhar à esquerda" active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()}>
        <AlignLeft className="size-4" />
      </Btn>
      <Btn title="Centralizar" active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()}>
        <AlignCenter className="size-4" />
      </Btn>
      <Btn title="Alinhar à direita" active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()}>
        <AlignRight className="size-4" />
      </Btn>
      <Divider />
      <Btn title="Link" active={editor.isActive("link")} onClick={setLink}>
        <Link2 className="size-4" />
      </Btn>
      <div className="flex items-center gap-0.5 px-1">
        {SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().setColor(c).run()}
            title={`Cor ${c}`}
            aria-label={`Cor ${c}`}
            className="size-4 rounded-full border border-black/10"
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      <Divider />
      <Btn title="Limpar formatação" onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}>
        <RemoveFormatting className="size-4" />
      </Btn>

      {variables?.length ? (
        <>
          <Divider />
          <div className="relative">
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setVarOpen((o) => !o)}
              title="Inserir variável"
              className="flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Braces className="size-4" />
              Variável
            </button>
            {varOpen ? (
              <>
                <button
                  type="button"
                  aria-hidden
                  tabIndex={-1}
                  onClick={() => setVarOpen(false)}
                  className="fixed inset-0 z-30 cursor-default"
                />
                <div className="absolute left-0 z-40 mt-1 max-h-64 w-52 overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-lg">
                  {variables.map((v) => (
                    <button
                      key={v.token}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        editor.chain().focus().insertContent(`{{${v.token}}}`).run();
                        setVarOpen(false);
                      }}
                      className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
                    >
                      <span>{v.label}</span>
                      <code className="text-xs text-muted-foreground">{`{{${v.token}}}`}</code>
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * A small WYSIWYG editor for proposal-template rich text (section bodies,
 * header/footer). Uncontrolled after mount: seeded with `value`, emits sanitized
 * HTML via `onChange` (empty string when blank). SSR-safe (immediatelyRender off).
 */
export function RichTextEditor({
  value,
  onChange,
  placeholder,
  minHeight = "7rem",
  variables,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: string;
  variables?: EditorVariable[];
}) {
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false, autolink: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TextStyle,
      Color,
      Placeholder.configure({ placeholder: placeholder ?? "" }),
    ],
    content: value || "",
    editorProps: {
      attributes: { class: "px-3 py-2 text-sm leading-relaxed focus:outline-none" },
    },
    onUpdate: ({ editor }) => onChangeRef.current(editor.isEmpty ? "" : editor.getHTML()),
  });

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card focus-within:border-brand">
      {editor ? <Toolbar editor={editor} variables={variables} /> : null}
      <div style={{ minHeight }} className="overflow-y-auto">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
