"use client";

import React, { useMemo, useState } from "react";
import { Chip, Input, Link } from "@nextui-org/react";
import { useTranslations } from "next-intl";
import clsx from "clsx";

import { TorrentItemProps } from "@/types";
import {
  hexToBase64,
  formatByteSize,
  getSizeColor,
  parseHighlight,
} from "@/utils";
import FileTypeIcon from "@/components/FileTypeIcon";

type FileItem = NonNullable<TorrentItemProps["files"]>[number] & {
  index: number | string;
  path: string;
  extension?: string;
  size?: number | string;
  type: "file";
  name: string;
};

type Directory = {
  index: string;
  type: "folder";
  name: string;
  path: string;
  children: (Directory | FileItem)[];
};

function fileTree(data: FileItem[], maxDepth: number = 3): Directory[] {
  const root: Directory = {
    index: "root",
    type: "folder",
    name: "",
    path: "",
    children: [],
  };

  for (const file of data) {
    const parts = file.path.split("/");
    const rootName = parts[0];

    if (parts.length === 1) {
      file.type = "file";
      file.name = rootName;
      root.children.push(file);
      continue;
    }

    let currentLevel = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];

      if (i === parts.length - 1) {
        file.type = "file";
        file.name = part;
        currentLevel.children.push(file);
      } else if (i === maxDepth) {
        const remainingPath = parts.slice(i).join("/");
        const sub = {
          ...file,
          path: remainingPath,
          name: remainingPath,
          type: "file",
        };

        currentLevel.children.push(sub as FileItem);
        break;
      } else {
        let nextLevel = currentLevel.children.find(
          (child): child is Directory => {
            return child.type === "folder" && child.name === part;
          },
        );

        if (!nextLevel) {
          nextLevel = {
            index: "_" + part,
            type: "folder",
            name: part,
            path: part,
            children: [],
          };
          currentLevel.children.push(nextLevel);
        }

        currentLevel = nextLevel;
      }
    }
  }

  return root.children as Directory[];
}

function filterFilesByNeedle(
  files: NonNullable<TorrentItemProps["files"]>,
  needle: string,
): NonNullable<TorrentItemProps["files"]> {
  const n = needle.trim().toLowerCase();
  if (!n) {
    return files;
  }

  return files.filter((f) => f.path.toLowerCase().includes(n));
}

function FileItem({
  file,
  highlight,
  collapsibleFolders,
}: {
  file: FileItem | Directory;
  highlight?: string | string[];
  collapsibleFolders: boolean;
}) {
  if (file.type === "folder" && collapsibleFolders) {
    return (
      <li className="flex flex-col justify-center mb-1">
        <details className="group/root open:pb-0" open>
          <summary className="file-item flex items-center text-xs md:text-sm md:leading-[1rem] cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            <FileTypeIcon
              className="dark:brightness-90"
              extension="folder"
            />
            <span
              className={clsx(
                "min-w-0 break-all min-h-5 text-default-500",
              )}
              title={file.path}
            >
              {file.name}
            </span>
          </summary>
          <ul className="sub-list pl-6 pt-1">
            {file.children.map((child) => (
              <FileItem
                key={child.index}
                collapsibleFolders={collapsibleFolders}
                file={child}
                highlight={highlight}
              />
            ))}
          </ul>
        </details>
      </li>
    );
  }

  if (file.type === "folder" && !collapsibleFolders) {
    return (
      <li className="flex flex-col justify-center mb-1">
        <div className="file-item flex items-center text-xs md:text-sm md:leading-[1rem]">
          <FileTypeIcon
            className="dark:brightness-90"
            extension="folder"
          />
          <span
            className={clsx(
              "min-w-0 break-all min-h-5 text-default-500",
            )}
            title={file.path}
          >
            {file.name}
          </span>
        </div>
        <ul className="sub-list pl-6 pt-1">
          {file.children.map((child) => (
            <FileItem
              key={child.index}
              collapsibleFolders={collapsibleFolders}
              file={child}
              highlight={highlight}
            />
          ))}
        </ul>
      </li>
    );
  }

  return (
    <li className="flex flex-col justify-center mb-1">
      <div className="file-item flex items-center text-xs md:text-sm md:leading-[1rem]">
        <FileTypeIcon
          className="dark:brightness-90"
          extension={file.type === "folder" ? "folder" : file.extension}
        />
        <span
          dangerouslySetInnerHTML={{
            __html: highlight
              ? parseHighlight(file.name, highlight)
              : file.name,
          }}
          className={clsx(
            "min-w-0 break-all min-h-5",
            file.type === "folder" && "text-default-500",
          )}
          title={file.path}
        />
        {file.type === "file" && file.size && (
          <Chip
            className={clsx(
              "h-[18px] mx-1 mt-[-1px] mb-auto px-[2px] text-[10px] font-bold dark:invert dark:brightness-105",
              getSizeColor(file.size),
            )}
            size="sm"
          >
            {formatByteSize(file.size)}
          </Chip>
        )}
      </div>
    </li>
  );
}

export default function FileList({
  torrent,
  highlight,
  max = -1,
  collapsibleFolders = true,
  enableTreeFilter = true,
}: {
  torrent: TorrentItemProps;
  highlight?: string | string[];
  max?: number;
  collapsibleFolders?: boolean;
  enableTreeFilter?: boolean;
}) {
  const t = useTranslations();
  const [treeFilter, setTreeFilter] = useState("");

  const fileRows = torrent.files ?? [];
  const baseList = max > 0 ? fileRows.slice(0, max) : fileRows;

  const filteredList = useMemo(
    () =>
      enableTreeFilter
        ? filterFilesByNeedle(baseList, treeFilter)
        : baseList,
    [baseList, treeFilter, enableTreeFilter],
  );

  const tree = useMemo(
    () => fileTree(filteredList as FileItem[], 3),
    [filteredList],
  );

  return (
    <div className="space-y-2">
      {enableTreeFilter && (
        <Input
          aria-label={t("Search.file_tree_filter_aria")}
          classNames={{
            inputWrapper: "h-9 min-h-9 bg-default-100",
            input: "text-xs",
          }}
          placeholder={t("Search.file_tree_filter_placeholder")}
          size="sm"
          value={treeFilter}
          onValueChange={setTreeFilter}
        />
      )}
      <ul>
        {tree.map((file) => (
          <FileItem
            key={file.index}
            collapsibleFolders={collapsibleFolders}
            file={file}
            highlight={highlight}
          />
        ))}
      </ul>
      {max > 0 && fileRows.length > max && (
        <Link
          isExternal
          className="text-sm italic text-gray-500"
          href={`/detail/${hexToBase64(torrent.hash)}`}
        >
          {t("Search.more_files", {
            count: fileRows.length - max,
          })}
        </Link>
      )}
    </div>
  );
}
