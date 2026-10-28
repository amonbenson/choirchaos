import type { Ref } from "vue";

import type Song from "@/core/models/song";

import { type EditorSelection, provideEditorSelection, useEditorSelection } from "./useEditorSelection";
import { type MeasureEditor, provideMeasureEditor, useMeasureEditor } from "./useMeasureEditor";

export type SongEditor = { selection: EditorSelection; editor: MeasureEditor };

/** Creates the song editor's selection and measure editor and provides both to the components below. */
export function provideSongEditor(song: Ref<Song | undefined>, editMode: Ref<boolean>): SongEditor {
  const selection = useEditorSelection(song, editMode);
  const editor = useMeasureEditor(song, editMode, selection);
  provideEditorSelection(selection);
  provideMeasureEditor(editor);
  return { selection, editor };
}
