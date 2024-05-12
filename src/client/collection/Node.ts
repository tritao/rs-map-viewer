export class Node {
  public id: number = 0;

  public next: Node | null = null;

  public previous: Node | null = null;

  public remove() {
    if (this.previous != null) {
      this.previous.next = this.next;
      if (this.next != null) {
        this.next.previous = this.previous;
        this.next = null;
      }
      this.previous = null;
    }
  }
}
