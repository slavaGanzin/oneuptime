export enum ColumnSort {
    ASC = 'ASC',
    DESC = 'DESC',
    DEFAULT = 'DEFAULT',
}

export type TableColumn = {
    title: string;
    key: string;
    sortDirection?: ColumnSort;
    isSortable?: boolean;
};