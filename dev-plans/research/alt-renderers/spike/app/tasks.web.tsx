/** The web layout: a header, the list, a footer; the same controls, so the same intent */
import {Collection} from 'sygnal'
import {View, Row, Txt} from '../primitives'
import {TaskLogic, TasksLogic, Draft, Add, ClearDone, Done, Remove, withView} from './tasks.logic'

export const Task = withView(TaskLogic, function Task({state}: any) {
  return (
    <Row className={state.done ? 'task done' : 'task'}>
      <Done checked={state.done} />
      <Txt className="title">{state.title}</Txt>
      <Remove aria-label="Remove">×</Remove>
    </Row>
  )
})

export default withView(TasksLogic, function Tasks({state}: any) {
  return (
    <View className="tasks">
      <Row className="new">
        <Draft value={state.draft} placeholder="New task" />
        <Add>Add</Add>
      </Row>
      <View className="list"><Collection of={Task} from="tasks" /></View>
      <Row className="footer">
        <Txt>{state.left} left</Txt>
        <ClearDone>Clear done</ClearDone>
      </Row>
    </View>
  )
})
