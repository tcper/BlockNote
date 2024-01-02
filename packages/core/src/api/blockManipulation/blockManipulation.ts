import { Node } from "prosemirror-model";

import type { BlockNoteEditor } from "../../editor/BlockNoteEditor";
import {
  Block,
  BlockIdentifier,
  BlockSchema,
  InlineContentSchema,
  PartialBlock,
  StyleSchema,
} from "../../schema";
import { blockToNode, nodeToBlock } from "../nodeConversions/nodeConversions";
import { getNodeById } from "../nodeUtil";

export function insertBlocks<
  BSchema extends BlockSchema,
  I extends InlineContentSchema,
  S extends StyleSchema
>(
  blocksToInsert: PartialBlock<BSchema, I, S>[],
  referenceBlock: BlockIdentifier,
  placement: "before" | "after" | "nested" = "before",
  editor: BlockNoteEditor<BSchema, I, S>
): Block<BSchema, I, S>[] {
  const ttEditor = editor._tiptapEditor;

  const id =
    typeof referenceBlock === "string" ? referenceBlock : referenceBlock.id;

  const nodesToInsert: Node[] = [];
  for (const blockSpec of blocksToInsert) {
    nodesToInsert.push(
      blockToNode(blockSpec, ttEditor.schema, editor.styleSchema)
    );
  }

  const { node, posBeforeNode } = getNodeById(id, ttEditor.state.doc);

  if (placement === "before") {
    ttEditor.view.dispatch(
      ttEditor.state.tr.insert(posBeforeNode, nodesToInsert)
    );
  }

  if (placement === "after") {
    ttEditor.view.dispatch(
      ttEditor.state.tr.insert(posBeforeNode + node.nodeSize, nodesToInsert)
    );
  }

  if (placement === "nested") {
    // Case if block doesn't already have children.
    if (node.childCount < 2) {
      const blockGroupNode = ttEditor.state.schema.nodes["blockGroup"].create(
        {},
        nodesToInsert
      );

      ttEditor.view.dispatch(
        ttEditor.state.tr.insert(
          posBeforeNode + node.firstChild!.nodeSize + 1,
          blockGroupNode
        )
      );
    }
  }

  // Now that the `PartialBlock`s have been converted to nodes, we can
  // re-convert them into full `Block`s.
  const insertedBlocks: Block<BSchema, I, S>[] = [];
  for (const node of nodesToInsert) {
    insertedBlocks.push(
      nodeToBlock(
        node,
        editor.blockSchema,
        editor.inlineContentSchema,
        editor.styleSchema,
        editor.blockCache
      )
    );
  }

  return insertedBlocks;
}

export function updateBlock<
  BSchema extends BlockSchema,
  I extends InlineContentSchema,
  S extends StyleSchema
>(
  blockToUpdate: BlockIdentifier,
  update: PartialBlock<BSchema, I, S>,
  editor: BlockNoteEditor<BSchema, I, S>
): Block<BSchema, I, S> {
  const ttEditor = editor._tiptapEditor;

  const id =
    typeof blockToUpdate === "string" ? blockToUpdate : blockToUpdate.id;
  const { posBeforeNode } = getNodeById(id, ttEditor.state.doc);

  ttEditor.commands.BNUpdateBlock(posBeforeNode + 1, update);

  const blockContainerNode = ttEditor.state.doc
    .resolve(posBeforeNode + 1)
    .node();

  return nodeToBlock(
    blockContainerNode,
    editor.blockSchema,
    editor.inlineContentSchema,
    editor.styleSchema,
    editor.blockCache
  );
}

export function removeBlocks<
  BSchema extends BlockSchema,
  I extends InlineContentSchema,
  S extends StyleSchema
>(
  blocksToRemove: BlockIdentifier[],
  editor: BlockNoteEditor<BSchema, I, S>
): Block<BSchema, I, S>[] {
  const ttEditor = editor._tiptapEditor;

  const idsOfBlocksToRemove = new Set<string>(
    blocksToRemove.map((block) =>
      typeof block === "string" ? block : block.id
    )
  );

  const removedBlocks: Block<BSchema, I, S>[] = [];
  let removedSize = 0;

  ttEditor.state.doc.descendants((node, pos) => {
    // Skips traversing nodes after all target blocks have been removed.
    if (idsOfBlocksToRemove.size === 0) {
      return false;
    }

    // Keeps traversing nodes if block with target ID has not been found.
    if (
      node.type.name !== "blockContainer" ||
      !idsOfBlocksToRemove.has(node.attrs.id)
    ) {
      return true;
    }

    idsOfBlocksToRemove.delete(node.attrs.id);
    const oldDocSize = ttEditor.state.doc.nodeSize;

    removedBlocks.push(
      nodeToBlock(
        node,
        editor.blockSchema,
        editor.inlineContentSchema,
        editor.styleSchema,
        editor.blockCache
      )
    );
    ttEditor.commands.BNDeleteBlock(pos - removedSize + 1);

    const newDocSize = ttEditor.state.doc.nodeSize;
    removedSize += oldDocSize - newDocSize;

    return false;
  });

  if (idsOfBlocksToRemove.size > 0) {
    const notFoundIds = [...idsOfBlocksToRemove].join("\n");

    throw Error(
      "Blocks with the following IDs could not be found in the editor: " +
        notFoundIds
    );
  }

  return removedBlocks;
}

export function replaceBlocks<
  BSchema extends BlockSchema,
  I extends InlineContentSchema,
  S extends StyleSchema
>(
  blocksToRemove: BlockIdentifier[],
  blocksToInsert: PartialBlock<BSchema, I, S>[],
  editor: BlockNoteEditor<BSchema, I, S>
): {
  insertedBlocks: Block<BSchema, I, S>[];
  removedBlocks: Block<BSchema, I, S>[];
} {
  const insertedBlocks = insertBlocks(
    blocksToInsert,
    blocksToRemove[0],
    "before",
    editor
  );
  const removedBlocks = removeBlocks(blocksToRemove, editor);

  return { insertedBlocks, removedBlocks };
}
