export type StaffsV1 = {
  layout: {
    x: number;
    y: number;
    height: number;
  };
  measures: {
    layout: {
      x: never;
      width: number;
    };
    measure: string;
  }[];
}[][];
