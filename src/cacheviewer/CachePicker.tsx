import {
  ColumnDef,
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  Row,
  useReactTable,
} from '@tanstack/react-table'

import { useVirtualizer } from '@tanstack/react-virtual'
import { MouseEventHandler, useReducer, useRef, useState } from 'react';
import { CacheViewer } from './CacheViewer';

export interface CachePickerContainerProps {
  cacheViewer: CacheViewer;
}

export function CachePicker({ cacheViewer }: CachePickerContainerProps): JSX.Element {

  type ModelId = {
    id: number
  }

  const modelLoader = cacheViewer.cacheLoaders.loaderFactory.getModelLoader();

  const count = Array.from(Array(modelLoader.getCount()).keys());
  let models: ModelId[] = count.map((i) => { return { id: i}; });

  // The scrollable element for your list
  const parentRef = useRef(null)

  // The virtualizer
  const rowVirtualizer = useVirtualizer({
    count: models.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 35,
    overscan: 5,
  })

  const onClick = (modelId: number) => {
    cacheViewer.setModel(modelId)
  };

  return (
    <>
      <div
        ref={parentRef}
        className="List"
        style={{
          height: `200px`,
          width: `400px`,
          overflow: 'auto',
          color: 'white',
        }}
      >
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => (
            <div
              key={virtualRow.index}
              className={virtualRow.index % 2 ? 'ListItemOdd' : 'ListItemEven'}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
              onClick={() => onClick(virtualRow.index)}
            >
              Model {virtualRow.index}
            </div>
          ))}
        </div>
      </div>
    </>
  )

  // function table() {
  //   const columnHelper = createColumnHelper<ModelId>();

  //   const columns = [
  //     columnHelper.accessor('id', {
  //       cell: info => info.getValue(),
  //       footer: info => info.column.id,
  //     }),
  //   ];

  //   const [data, _setData] = useState(() => [...defaultData]);
  //   const table = useReactTable({
  //     data,
  //     columns,
  //     getCoreRowModel: getCoreRowModel(),
  //   });

  //   return (
  //     <div className="p-2">
  //       <table>
  //         <thead>
  //           {table.getHeaderGroups().map(headerGroup => (
  //             <tr key={headerGroup.id}>
  //               {headerGroup.headers.map(header => (
  //                 <th key={header.id}>
  //                   {header.isPlaceholder
  //                     ? null
  //                     : flexRender(
  //                       header.column.columnDef.header,
  //                       header.getContext()
  //                     )}
  //                 </th>
  //               ))}
  //             </tr>
  //           ))}
  //         </thead>
  //         <tbody>
  //           {table.getRowModel().rows.map(row => (
  //             <tr key={row.id}>
  //               {row.getVisibleCells().map(cell => (
  //                 <td key={cell.id}>
  //                   {flexRender(cell.column.columnDef.cell, cell.getContext())}
  //                 </td>
  //               ))}
  //             </tr>
  //           ))}
  //         </tbody>
  //         <tfoot>
  //           {table.getFooterGroups().map(footerGroup => (
  //             <tr key={footerGroup.id}>
  //               {footerGroup.headers.map(header => (
  //                 <th key={header.id}>
  //                   {header.isPlaceholder
  //                     ? null
  //                     : flexRender(
  //                       header.column.columnDef.footer,
  //                       header.getContext()
  //                     )}
  //                 </th>
  //               ))}
  //             </tr>
  //           ))}
  //         </tfoot>
  //       </table>
  //       <div className="h-4" />
  //     </div>
  //   );
  // }
}

